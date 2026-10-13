// Runs one Node mod on its own worker thread. Started by runner.js.
//
// Before the mod loads, this sets up what the rednode package needs:
//   - `import ... from "rednode"` (or require) resolves to the SDK the host ships;
//   - globalThis[Symbol.for('rednode.transport')] carries calls, events and UI
//     messages through runner.js to the host.
// A thrown error that nothing catches ends this worker only; runner.js reports it.

'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { registerHooks } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { id, dir, main, sdk, dataDir, appsDirs, debug } = workerData;

// The mod's Debug switch (Mod Manager): Node's inspector, opened from this thread so
// a debugger attaches to the mod's own thread. A free local port; it does not wait
// for a debugger, so use a debugger statement or a breakpoint set after attaching.
if (debug) {
  const inspector = require('node:inspector');
  inspector.open(0, '127.0.0.1');
  parentPort.postMessage({ t: 'inspector', url: inspector.url() });
}

// This package, for `pkg` in the rednode package.
globalThis[Symbol.for('rednode.package')] = Object.freeze({ id, dir, dataDir, appsDirs });
const sdkUrl = pathToFileURL(sdk).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'rednode') return { url: sdkUrl, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let nextRequest = 1;
const pending = new Map(); // request id -> { resolve, reject }
const listeners = new Set();

function request(message) {
  const rid = nextRequest++;
  return new Promise((resolve, reject) => {
    pending.set(rid, { resolve, reject });
    parentPort.postMessage({ ...message, rid });
  });
}

globalThis[Symbol.for('rednode.transport')] = {
  call: (method, params) => request({ t: 'call', method, params }),
  state: () => request({ t: 'state' }),
  secret: (op, name, value) => request({ t: 'secret', op, name, value }),
  mcp: () => request({ t: 'mcp' }),
  bridge: (op, method, params) => request({ t: 'bridge', op, method, params }),
  requires: () => request({ t: 'requires' }),
  post: (data) => parentPort.postMessage({ t: 'post', data }),
  agent: (msg) => parentPort.postMessage({ t: 'agent', msg }),
  listen(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  ui: {
    open: (window, spec) => parentPort.postMessage({ t: 'ui', op: 'open', window, spec }),
    update: (window, node, props) => parentPort.postMessage({ t: 'ui', op: 'update', window, node, props }),
    close: (window) => parentPort.postMessage({ t: 'ui', op: 'close', window }),
  },
};

parentPort.on('message', (m) => {
  switch (m.t) {
    case 'reply': {
      const p = pending.get(m.rid);
      if (!p) return;
      pending.delete(m.rid);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
      return;
    }
    case 'event':
      for (const fn of listeners) fn(m.message);
      return;
    case 'ping':
      parentPort.postMessage({ t: 'pong' });
      return;
    default:
      return;
  }
});

import(pathToFileURL(path.join(dir, main)).href).then(
  () => parentPort.postMessage({ t: 'loaded' }),
  (err) => {
    throw err; // an error while loading counts as a crash, reported by runner.js
  },
);
