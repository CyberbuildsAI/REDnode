// A REDnode mod process. The host starts one with Electron's utilityProcess for
// each mod that runs alone, and one for the shared group. Every mod runs on its
// own worker thread (worker.js), so a thrown error, an endless loop or
// process.exit() in one mod stops only that mod. A native crash or running out
// of memory still ends the whole process, and with it every mod in it.
//
// Host -> runner (process.parentPort):
//   { t: 'start', mod: { id, dir, main }, sdk }   start a mod
//   { t: 'stop', id }                            stop a mod
//   { t: 'to-mod', id, message }                 a reply or event for one mod
//   { t: 'broadcast', message }                  an event for every mod
// Runner -> host:
//   { t: 'from-mod', id, message }               a call, state request or UI message
//   { t: 'log', id, level, text }                a line the mod printed
//   { t: 'status', id, status, error? }          running, crashed, not-responding, stopped

'use strict';

const { Worker } = require('node:worker_threads');
const path = require('node:path');
const readline = require('node:readline');

const port = process.parentPort;
const WORKER = path.join(__dirname, 'worker.js');
const PING_EVERY = 2000;
const HUNG_AFTER = 10000;

/** Running mods by id: { worker, lastPong, hung, stopping } */
const mods = new Map();

function send(message) {
  port.postMessage(message);
}

function pipeLines(stream, id, level) {
  readline.createInterface({ input: stream }).on('line', (text) => send({ t: 'log', id, level, text }));
}

function start(mod, sdk) {
  if (mods.has(mod.id)) return;
  const worker = new Worker(WORKER, {
    workerData: { ...mod, sdk },
    stdout: true,
    stderr: true,
    name: `rednode mod ${mod.id}`,
  });
  const entry = { worker, lastPong: Date.now(), hung: false, stopping: false };
  mods.set(mod.id, entry);
  pipeLines(worker.stdout, mod.id, 'info');
  pipeLines(worker.stderr, mod.id, 'error');

  worker.on('message', (m) => {
    if (m.t === 'pong') {
      entry.lastPong = Date.now();
      if (entry.hung) {
        entry.hung = false;
        send({ t: 'status', id: mod.id, status: 'running' });
      }
    } else if (m.t === 'loaded') {
      send({ t: 'status', id: mod.id, status: 'running' });
    } else {
      send({ t: 'from-mod', id: mod.id, message: m });
    }
  });
  worker.on('error', (err) => {
    entry.error = err?.stack || String(err);
  });
  worker.on('exit', (code) => {
    mods.delete(mod.id);
    if (entry.stopping) {
      send({ t: 'status', id: mod.id, status: 'stopped' });
    } else {
      send({
        t: 'status',
        id: mod.id,
        status: 'crashed',
        error: entry.error ?? `The mod exited with code ${code}`,
      });
    }
  });
}

function stop(id) {
  const entry = mods.get(id);
  if (!entry) return; // already gone: its exit was reported then
  entry.stopping = true;
  entry.worker.terminate(); // also stops a mod stuck in an endless loop
}

port.on('message', ({ data: m }) => {
  switch (m.t) {
    case 'start':
      start(m.mod, m.sdk);
      break;
    case 'stop':
      stop(m.id);
      break;
    case 'to-mod':
      mods.get(m.id)?.worker.postMessage(m.message);
      break;
    case 'broadcast':
      for (const entry of mods.values()) entry.worker.postMessage({ t: 'event', message: m.message });
      break;
    default:
      break;
  }
});

// A mod that stops answering is reported, so the launcher can offer a restart.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of mods) {
    entry.worker.postMessage({ t: 'ping' });
    if (!entry.hung && now - entry.lastPong > HUNG_AFTER) {
      entry.hung = true;
      send({ t: 'status', id, status: 'not-responding' });
    }
  }
}, PING_EVERY);
