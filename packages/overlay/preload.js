// Gives overlay apps window.rednode, and draws the cursor in interactive mode
// (off-screen Chromium does not paint one).

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('rednode:event', (_event, message) => {
  for (const fn of listeners) fn(message);
});

contextBridge.exposeInMainWorld('rednode', {
  /** Calls a game method through the bridge. Resolves with its result. */
  call: (method, params) => ipcRenderer.invoke('rednode:call', method, params),
  /** Subscribes to messages from the game. Returns an unsubscribe function. */
  on: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Connection state: { connected, mode, windowed }. */
  state: () => ipcRenderer.invoke('rednode:state'),
});

window.addEventListener('DOMContentLoaded', async () => {
  const { windowed } = await ipcRenderer.invoke('rednode:state');
  if (windowed) return; // the desktop draws the real cursor

  const cursor = document.createElement('div');
  cursor.style.cssText =
    'position:fixed;left:0;top:0;width:18px;height:24px;pointer-events:none;z-index:2147483647;display:none;' +
    'filter:drop-shadow(0 0 2px #000)';
  cursor.innerHTML =
    '<svg width="18" height="24" viewBox="0 0 18 24"><path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.6 L9 13.4 L16 13.4 Z" ' +
    'fill="#fcee0a" stroke="#08090d" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);

  document.addEventListener('mousemove', (e) => {
    cursor.style.transform = `translate(${e.clientX - 1}px, ${e.clientY - 1}px)`;
  });
  listeners.add((m) => {
    if (m.event === 'overlay' || m.event === 'hello') cursor.style.display = m.mode === 'interactive' ? 'block' : 'none';
  });
});
