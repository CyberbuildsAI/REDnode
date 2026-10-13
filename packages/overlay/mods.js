// Node mods in the overlay host: starting, stopping, grouping and logging.
//
// A Node mod is a package whose rednode-app.json has "main". Each mod runs on a
// worker thread inside a mod process (runtime/runner.js, an Electron
// utilityProcess). By default every mod gets its own process. The player can
// put mods in the shared group to save memory: one process, one worker per mod.
// A mod can refuse that with "isolation": "process".
//
// Calls, state requests and UI messages from mods come in here; the host's
// main.js answers them through the functions passed to createMods().

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHARED = 'shared';
const LOG_LINES = 200; // kept per mod for the launcher
const RECENT_LINES = 500; // kept for the Mod log app, all mods together
const RESTARTS = 3; // a mod process that crashes more often than this in a minute is left stopped

/**
 * @param {object} host
 * @param {import('electron').App} host.app
 * @param {typeof import('electron').utilityProcess} host.utilityProcess
 * @param {(...args: string[]) => void} host.log            the host log
 * @param {string} host.logFile                             where mod output goes
 * @param {string} host.runner                              runtime/runner.js
 * @param {string} host.sdk                                 the rednode package's index.js
 * @param {(method: string, params: unknown) => Promise<unknown>} host.call   the game bridge
 * @param {() => object} host.state                         what game.state() answers
 * @param {object} host.ui                                  open(modId, win, spec), update(modId, win, node, props), close(modId, win), closeAll(modId)
 * @param {() => void} host.changed                         a mod's status changed: refresh the launcher
 * @param {(entry: object) => void} host.onLog               a mod printed a line: { time, id, level, text }
 */
function createMods(host) {
  /** Mods by id: { entry, enabled, status, error, log: string[], process: key | null, restartedAt } */
  const mods = new Map();
  /** Mod processes by key ('shared' or 'own:<id>'): { proc, mods: Set<id>, crashes: number[], stopping } */
  const processes = new Map();
  /** The newest lines of every mod, oldest first, for the Mod log app. */
  const recent = [];
  let starts = 0; // numbers each start of a mod, so late messages from an earlier start are ignored
  let logSeq = 0; // numbers every line, so a page that also gets the history can skip repeats

  // ---------- the mod log ----------

  try {
    fs.mkdirSync(path.dirname(host.logFile), { recursive: true });
    fs.appendFileSync(host.logFile, `\n---- REDnode mods, ${new Date().toString()} ----\n`);
  } catch {
    // the log is best effort
  }

  function modLog(id, level, text) {
    const time = new Date().toTimeString().slice(0, 8); // local time, like the player's clock
    const line = `${time} [${id}]${level === 'error' ? ' ERROR' : ''} ${text}`;
    const entry = { seq: ++logSeq, time, id, level, text };
    recent.push(entry);
    if (recent.length > RECENT_LINES) recent.shift();
    host.onLog(entry);
    const m = mods.get(id);
    if (m) {
      m.log.push(line);
      if (m.log.length > LOG_LINES) m.log.shift();
    }
    try {
      fs.appendFileSync(host.logFile, `${line}\n`);
    } catch {
      // best effort
    }
    if (!host.app.isPackaged) console.log(line);
  }

  // Keeps a crash's message and the stack lines in the mod's own code. Frames
  // inside Node, the mod runtime and the rednode package say nothing to the author.
  function modFrames(error) {
    const [message, ...stack] = String(error).split('\n');
    const own = stack.filter(
      (l) => !/node:internal|[\\/]runtime[\\/]worker\.js|[\\/](rednode[\\/]dist|sdk)[\\/]/.test(l),
    );
    return [message, ...own].join('\n');
  }

  // ---------- grouping ----------

  function canShare(m) {
    return m.entry.manifest.isolation !== 'process';
  }

  function processKey(m) {
    return m.shared && canShare(m) ? SHARED : `own:${m.entry.manifest.id}`;
  }

  // ---------- mod processes ----------

  function ensureProcess(key) {
    let p = processes.get(key);
    if (p) return p;
    const proc = host.utilityProcess.fork(host.runner, [], {
      serviceName: key === SHARED ? 'REDnode mods (shared)' : `REDnode mod ${key.slice(4)}`,
    });
    p = { key, proc, mods: new Set(), crashes: [], stopping: false };
    processes.set(key, p);
    proc.on('message', (m) => onRunnerMessage(p, m));
    proc.on('exit', (code) => onProcessExit(p, code));
    return p;
  }

  function onProcessExit(p, code) {
    if (processes.get(p.key) === p) processes.delete(p.key);
    if (p.stopping || !p.mods.size) return;
    const names = [...p.mods];
    const where = p.key === SHARED ? 'The shared mod process' : 'The mod process';
    host.log(`${where} ended (code ${code}). Mods in it: ${names.join(', ')}`);
    const now = Date.now();
    const recent = [...p.crashes, now].filter((t) => now - t < 60000);
    for (const id of names) {
      const m = mods.get(id);
      if (!m) continue;
      m.process = null;
      m.stopping = false;
      host.ui.closeAll(id);
      modLog(id, 'error', `crashed: ${where} ended (code ${code}). Mods in it: ${names.join(', ')}`);
      setStatus(id, 'crashed', `${where} ended (code ${code}). Mods in it: ${names.join(', ')}`);
    }
    if (recent.length > RESTARTS) {
      host.log(`${where} crashed ${recent.length} times in a minute; not restarting it`);
      return;
    }
    // Restart the mods that were in it, a moment later.
    setTimeout(() => {
      for (const id of names) {
        const m = mods.get(id);
        if (m && m.enabled && m.status === 'crashed' && !m.process) start(id, recent);
      }
    }, 2000);
  }

  function onRunnerMessage(p, msg) {
    switch (msg.t) {
      case 'log':
        modLog(msg.id, msg.level, msg.text);
        return;
      case 'status':
        onStatus(p, msg);
        return;
      case 'from-mod':
        onModMessage(p, msg.id, msg.message);
        return;
      default:
        return;
    }
  }

  function onStatus(p, msg) {
    const m = mods.get(msg.id);
    // A message from an earlier start of this mod (it was restarted or replaced meanwhile).
    if (m && msg.gen !== undefined && msg.gen !== m.gen) return;
    if (!m) {
      // A removed mod's last message: only the process still counts it.
      if (msg.status === 'crashed' || msg.status === 'stopped') {
        p.mods.delete(msg.id);
        if (!p.mods.size && p.key !== SHARED) stopProcess(p);
      }
      return;
    }
    if (msg.status === 'crashed' || msg.status === 'stopped') {
      p.mods.delete(msg.id);
      // An own process with no mod left is not needed any more.
      if (!p.mods.size && p.key !== SHARED) stopProcess(p);
      // A late message from a process the mod has already left: nothing else to do.
      if (m.process !== p.key) return;
      m.process = null;
      m.stopping = false;
      host.ui.closeAll(msg.id);
      if (msg.status === 'crashed') modLog(msg.id, 'error', `crashed: ${modFrames(msg.error)}`);
      else modLog(msg.id, 'info', 'Stopped');
      if (m.pendingStart) {
        m.pendingStart = false;
        start(msg.id);
        return;
      }
    }
    setStatus(msg.id, msg.status, msg.error);
  }

  function stopProcess(p) {
    p.stopping = true;
    processes.delete(p.key);
    p.proc.kill();
  }

  function setStatus(id, status, error) {
    const m = mods.get(id);
    if (!m) return;
    m.status = status;
    if (status === 'running' || status === 'starting') m.error = null;
    else if (error) m.error = error;
    host.changed();
  }

  // ---------- messages from mods ----------

  function reply(p, id, rid, result, error) {
    p.proc.postMessage({ t: 'to-mod', id, message: { t: 'reply', rid, result, error } });
  }

  function onModMessage(p, id, msg) {
    switch (msg.t) {
      case 'call':
        Promise.resolve()
          .then(() => host.call(msg.method, msg.params))
          .then(
            (result) => reply(p, id, msg.rid, result),
            (err) => reply(p, id, msg.rid, undefined, err?.message || String(err)),
          );
        return;
      case 'state':
        reply(p, id, msg.rid, host.state());
        return;
      case 'post':
        host.post(id, msg.data);
        return;
      case 'agent':
        host.agent(id, msg.msg);
        return;
      case 'secret':
      case 'mcp':
        try {
          const result = msg.t === 'secret' ? host.secret(id, msg.op, msg.name, msg.value) : host.mcpFor(id);
          reply(p, id, msg.rid, result);
        } catch (err) {
          reply(p, id, msg.rid, undefined, err.message);
        }
        return;
      case 'ui':
        if (msg.op === 'open') host.ui.open(id, String(msg.window), msg.spec);
        else if (msg.op === 'update') host.ui.update(id, String(msg.window), String(msg.node), msg.props ?? {});
        else if (msg.op === 'close') host.ui.close(id, String(msg.window));
        return;
      default:
        return;
    }
  }

  // ---------- starting and stopping ----------

  function start(id, crashes) {
    const m = mods.get(id);
    if (!m) return;
    if (m.process) {
      // Still stopping (a reload): start again once the old worker is gone.
      m.pendingStart = true;
      return;
    }
    const key = processKey(m);
    const p = ensureProcess(key);
    if (crashes) p.crashes = crashes;
    p.mods.add(id);
    m.process = key;
    m.stopping = false;
    m.gen = ++starts;
    m.log.length = 0;
    modLog(id, 'info', `Starting ${m.entry.manifest.main} in ${key === SHARED ? 'the shared process' : 'its own process'}`);
    setStatus(id, 'starting');
    const { manifest } = m.entry;
    p.proc.postMessage({
      t: 'start',
      mod: { id, gen: m.gen, dir: m.entry.dir, main: manifest.main, dataDir: host.dataDir(id), appsDirs: host.appsDirs },
      sdk: host.sdk,
    });
  }

  // Stops a mod. With thenStart, starts it again once its worker is gone (a reload).
  function stop(id, thenStart = false) {
    const m = mods.get(id);
    if (!m) return;
    m.pendingStart = thenStart;
    host.ui.closeAll(id);
    if (m.stopping) return; // already asked; the answer starts it again if thenStart
    const p = m.process && processes.get(m.process);
    if (p) {
      m.stopping = true;
      p.proc.postMessage({ t: 'stop', id });
    } else {
      setStatus(id, 'stopped');
    }
  }

  function restart(id, why = 'Restarting') {
    const m = mods.get(id);
    if (!m || !m.enabled) return;
    modLog(id, 'info', why);
    if (m.process) stop(id, true);
    else start(id);
  }

  // ---------- public ----------

  return {
    /** Registers the installed mods. Call once, after discovering apps. */
    add(entry, { enabled, shared }) {
      mods.set(entry.manifest.id, {
        entry,
        enabled,
        shared: !!shared,
        status: 'stopped',
        error: null,
        log: [],
        process: null,
        pendingStart: false,
        stopping: false,
      });
      if (enabled) start(entry.manifest.id);
    },

    has: (id) => mods.has(id),

    /** Stops a mod and forgets it: its package was removed or changed. */
    remove(id) {
      const m = mods.get(id);
      if (!m) return;
      m.enabled = false;
      stop(id);
      mods.delete(id);
      host.changed();
    },

    isEnabled: (id) => !!mods.get(id)?.enabled,

    /** The newest lines of every mod, oldest first. */
    recentLog: () => recent.slice(),

    setEnabled(id, enabled) {
      const m = mods.get(id);
      if (!m || m.enabled === enabled) return;
      m.enabled = enabled;
      if (enabled) start(id);
      else stop(id);
    },

    /** Moves a mod into the shared group or back to its own process. Restarts it. */
    setShared(id, shared) {
      const m = mods.get(id);
      if (!m || m.shared === !!shared) return;
      if (shared && !canShare(m)) throw new Error(`${m.entry.manifest.name} must run in its own process`);
      m.shared = !!shared;
      if (m.enabled) restart(id, shared ? 'Moving to the shared process' : 'Moving to its own process');
    },

    restart,

    /** Sends an event (a game event or a state change) to every running mod. */
    broadcast(message) {
      for (const p of processes.values()) p.proc.postMessage({ t: 'broadcast', message });
    },

    /** Sends an event to one mod. */
    toMod(id, message) {
      const m = mods.get(id);
      const p = m?.process && processes.get(m.process);
      if (p) p.proc.postMessage({ t: 'to-mod', id, message: { t: 'event', message } });
    },

    /** What the launcher shows for a mod. */
    info(id, metrics) {
      const m = mods.get(id);
      if (!m) return null;
      const p = m.process && processes.get(m.process);
      const mem = p && metrics.find((x) => x.pid === p.proc.pid);
      return {
        status: m.status,
        error: m.error,
        shared: m.shared,
        canShare: canShare(m),
        memoryMB: mem ? Math.round(mem.memory.workingSetSize / 1024) : null,
        processMods: p ? p.mods.size : 0,
        log: m.log.slice(-5),
      };
    },

    /** One line per mod process, for the host log. */
    memorySummary(metrics) {
      const parts = [];
      for (const p of processes.values()) {
        const mem = metrics.find((x) => x.pid === p.proc.pid);
        const mb = mem ? Math.round(mem.memory.workingSetSize / 1024) : '?';
        const label = p.key === SHARED ? `shared [${[...p.mods].join(', ')}]` : `${p.key.slice(4)} (own)`;
        parts.push(`${label} ${mb} MB`);
      }
      return parts.join('; ');
    },

    /** Stops every mod process. */
    stopAll() {
      for (const p of [...processes.values()]) stopProcess(p);
    },
  };
}

module.exports = { createMods };
