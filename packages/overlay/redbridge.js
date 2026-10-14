// REDbridge for packages (W2, kernel.bridge()): WolvenKit's engine behind JSON-RPC,
// a separate GPL-3.0 program (https://github.com/Edgemodders/REDbridge). REDnode
// does not ship it: it finds the copy REDdeck or REDcode fetched, starts it on the
// first call with the game folder, and shares it between the packages the player
// allowed. It stops after IDLE_MS without calls; the next call starts it again.
//
// The protocol is JSON-RPC 2.0 on the bridge's stdio, Content-Length framed as
// language servers do; stderr is its log.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const IDLE_MS = 10 * 60 * 1000;
// Editors whose storage folders may hold a fetched REDbridge, and the extensions that fetch it.
const EDITORS = ['Code', 'Code - Insiders', 'VSCodium', 'EDGEkit', 'Cursor'];
// redcode-core is REDcode before 0.6.0, when the extension became edgemodders.redcode; both are looked at.
const EXTENSIONS = ['edgemodders.reddeck', 'edgemodders.redcode', 'edgemodders.redcode-core'];

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * REDbridge.exe: a configured path (a file or its folder), REDBRIDGE_EXE, or the newest
 * copy REDdeck or REDcode fetched into an editor's storage. { exe, version, source } or null.
 */
function findRedbridge(configured) {
  for (const [p, source] of [
    [configured, 'the REDnode setting'],
    [process.env.REDBRIDGE_EXE, 'REDBRIDGE_EXE'],
  ]) {
    if (!p) continue;
    const exe = isFile(p) ? p : path.join(p, 'REDbridge.exe');
    if (isFile(exe)) return { exe, version: null, source };
  }
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const copies = [];
  for (const editor of EDITORS) {
    for (const ext of EXTENSIONS) {
      const dir = path.join(appData, editor, 'User', 'globalStorage', ext, 'bridge');
      let tags = [];
      try {
        tags = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const tag of tags) {
        const exe = path.join(dir, tag, 'REDbridge.exe');
        if (isFile(exe)) copies.push({ exe, version: tag.replace(/^v/, ''), source: `${ext === EXTENSIONS[0] ? 'REDdeck' : 'REDcode'} (${editor})` });
      }
    }
  }
  copies.sort((a, b) => compareVersions(b.version, a.version));
  return copies[0] ?? null;
}

// REDbridge needs .NET 10. A machine-wide install wins; otherwise a per-user one, set
// for the bridge process only (a user-level DOTNET_ROOT once broke other programs).
function dotnetRoot() {
  const has10 = (root) => {
    try {
      return fs.readdirSync(path.join(root, 'shared', 'Microsoft.NETCore.App')).some((v) => v.startsWith('10.'));
    } catch {
      return false;
    }
  };
  const machine = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'dotnet');
  if (has10(machine)) return null;
  const user = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'dotnet');
  return has10(user) ? user : null;
}

/**
 * @param {object} host
 * @param {(...args: string[]) => void} host.log
 * @param {() => string | null} host.gameDir      the game folder, for --game
 * @param {() => string | undefined} host.configured  a REDbridge path from the settings
 */
function createRedbridge(host) {
  let child = null;
  let found = null;
  let nextId = 1;
  const pending = new Map(); // id -> { resolve, reject, method }
  let idleTimer = null;
  let buffer = Buffer.alloc(0);

  function locate() {
    found = findRedbridge(host.configured());
    return found;
  }

  function start() {
    if (child) return;
    if (!locate()) {
      throw new Error(
        'REDbridge is not installed. Get it with REDdeck ("Get REDbridge") or REDcode in VS Code, ' +
          'or set its path in REDnode (REDBRIDGE_EXE).',
      );
    }
    const args = host.gameDir() ? ['--game', host.gameDir()] : [];
    const env = { ...process.env };
    const root = dotnetRoot();
    if (root) env.DOTNET_ROOT = root;
    host.log(`REDbridge ${found.version ?? ''} starting from ${found.source}: ${found.exe}`.replace('  ', ' '));
    const proc = spawn(found.exe, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child = proc;
    buffer = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => onData(chunk));
    readline.createInterface({ input: proc.stderr }).on('line', (line) => host.log(`[REDbridge] ${line}`));
    proc.on('error', (err) => host.log(`REDbridge could not start: ${err.message}`));
    proc.on('exit', (code) => {
      if (child === proc) child = null;
      host.log(`REDbridge ended (code ${code})`);
      for (const [, p] of pending) p.reject(new Error(`REDbridge ended (code ${code}) before answering ${p.method}`));
      pending.clear();
    });
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buffer = buffer.subarray(end + 4); // not a header we understand: skip it
        continue;
      }
      const length = Number(m[1]);
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      buffer = buffer.subarray(end + 4 + length);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      const p = msg.id !== undefined && pending.get(msg.id);
      if (!p) continue; // a notification, or an answer nobody waits for
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || `REDbridge error ${msg.error.code}`));
      else p.resolve(msg.result);
      idle();
    }
  }

  function idle() {
    clearTimeout(idleTimer);
    if (pending.size) return;
    idleTimer = setTimeout(() => {
      if (!pending.size && child) {
        host.log('REDbridge idle for 10 minutes; stopping it');
        stop();
      }
    }, IDLE_MS);
  }

  /** Calls a REDbridge method; params by name, as REDbridge's docs list them. */
  function call(method, params) {
    if (typeof method !== 'string' || !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/.test(method)) {
      return Promise.reject(new Error(`Not a REDbridge method: ${method}`));
    }
    try {
      start();
    } catch (err) {
      return Promise.reject(err);
    }
    clearTimeout(idleTimer);
    const id = nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }), 'utf8');
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    });
  }

  function stop() {
    clearTimeout(idleTimer);
    const proc = child;
    child = null;
    if (proc) {
      proc.stdin.end();
      proc.kill();
    }
  }

  /** Whether REDbridge is found and running, for the Mod Manager and kernel.bridge(). */
  function status() {
    const f = child ? found : locate();
    return { found: !!f, exe: f?.exe ?? null, version: f?.version ?? null, source: f?.source ?? null, running: !!child };
  }

  return { call, stop, status };
}

module.exports = { createRedbridge, findRedbridge };
