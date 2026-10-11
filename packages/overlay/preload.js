// Gives overlay apps window.rednode. The cursor is drawn by the REDnode plugin
// in the game, so it moves at the game's frame rate.

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
