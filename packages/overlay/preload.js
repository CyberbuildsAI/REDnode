// Gives overlay apps window.rednode, and reports the page's drag handles.
// The cursor is drawn by the REDnode plugin in the game, so it moves at the
// game's frame rate. Dragging is done by the plugin too.

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
  /** Connection state: { connected, mode, windowed, version }. */
  state: () => ipcRenderer.invoke('rednode:state'),
  /** Installed apps. Only the built-in REDnode launcher may use these; other apps get an error. */
  apps: {
    list: () => ipcRenderer.invoke('rednode:apps:list'),
    setOpen: (id, open) => ipcRenderer.invoke('rednode:apps:set-open', id, open),
  },
});

// Elements marked data-rednode-drag are drag handles: pressing on one moves the
// window instead of clicking the page. Their rectangles are sent to the plugin
// whenever the layout changes. Handles inside open shadow roots count too, so
// components like <rn-window> can provide their own title bar.
window.addEventListener('DOMContentLoaded', () => {
  let last = '';
  let queued = false;

  const report = () => {
    queued = false;
    const regions = [];
    const collect = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.hasAttribute('data-rednode-drag')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) regions.push(r.left, r.top, r.width, r.height);
        }
        if (el.shadowRoot) collect(el.shadowRoot);
      }
    };
    collect(document);
    const key = regions.map(Math.round).join(',');
    if (key !== last) {
      last = key;
      ipcRenderer.send('rednode:drag-regions', regions);
    }
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(report);
    }
  };

  const resize = new ResizeObserver(schedule);
  const watch = () => {
    resize.disconnect();
    resize.observe(document.documentElement);
    document.querySelectorAll('[data-rednode-drag]').forEach((el) => resize.observe(el));
    schedule();
  };
  new MutationObserver(watch).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-rednode-drag', 'class', 'style', 'hidden'],
  });
  window.addEventListener('resize', schedule);
  document.fonts?.addEventListener?.('loadingdone', schedule);
  setInterval(schedule, 1000); // shadow DOM changes are not observed above; this catches them
  watch();
});
