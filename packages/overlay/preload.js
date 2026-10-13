// Gives overlay apps window.rednode, and reports the page's drag handles.
// The cursor is drawn by the REDnode plugin in the game, so it moves at the
// game's frame rate. Dragging is done by the plugin too.

'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// The Node debugger (a mod with its Debug switch on) is Chromium's DevTools page talking
// to the mod's worker over a WebSocket. Loading an ES module makes Node add a context
// named "internal", and DevTools picks it for the console, where the mod's globals are
// missing. Hide it before DevTools connects, so the console starts in the mod's context.
if (location.protocol === 'devtools:' && /[?&]ws=/.test(location.search)) {
  webFrame.executeJavaScript(`(() => {
    const Base = window.WebSocket;
    const hidden = new Set();
    const keep = (data) => {
      try {
        const m = JSON.parse(data);
        if (m.method === 'Runtime.executionContextCreated' && m.params.context.name === 'internal') {
          hidden.add(m.params.context.id);
          return false;
        }
        if (m.method === 'Runtime.executionContextDestroyed') return !hidden.has(m.params.executionContextId);
      } catch {}
      return true;
    };
    window.WebSocket = class extends Base {
      set onmessage(fn) {
        super.onmessage = fn && ((e) => keep(e.data) && fn.call(this, e));
      }
      get onmessage() {
        return super.onmessage;
      }
    };
  })()`);
}

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
  /** Connection and game state: { connected, mode, windowed, version, game, theme, developer }. */
  state: () => ipcRenderer.invoke('rednode:state'),
  /** Closes this app, as switching it off in the launcher does. The UI kit's window close button uses it. */
  close: () => ipcRenderer.send('rednode:app:close'),
  /** Opens the debugger for this window. Only in Developer mode; the UI kit's window debug button uses it. */
  debug: () => ipcRenderer.invoke('rednode:app:debug'),
  /** Installed apps and mods. Only the built-in launcher and Mod Manager may use these; other apps get an error. */
  apps: {
    list: () => ipcRenderer.invoke('rednode:apps:list'),
    setOpen: (id, open) => ipcRenderer.invoke('rednode:apps:set-open', id, open),
    /** Moves a Node mod into the shared mod process, or back to its own. */
    setShared: (id, shared) => ipcRenderer.invoke('rednode:mods:set-shared', id, shared),
    /** Runs a Node mod with Node's inspector on, in its own process, or back to normal. Restarts it. */
    setDebug: (id, on) => ipcRenderer.invoke('rednode:mods:debug', id, on),
    /** Opens the Node debugger for a mod running with the debugger: in the game ("overlay", default) or on the desktop. */
    inspectMod: (id, where) => ipcRenderer.invoke('rednode:mods:inspect', id, where),
    /** Copies a debugged mod's inspector address, for VS Code or REDcode. */
    copyInspector: (id) => ipcRenderer.invoke('rednode:mods:copy-inspector', id),
    /** Gets Developer mode, or turns it on or off. On, window title bars show a debug button. */
    developer: (on) => ipcRenderer.invoke('rednode:host:developer', on),
    /** Restarts a Node mod. */
    restart: (id) => ipcRenderer.invoke('rednode:mods:restart', id),
    /** Pins a package to the launcher (where "launcher") or its windows to the HUD (where "hud"), or unpins it. */
    pin: (id, where, on) => ipcRenderer.invoke('rednode:apps:pin', id, where, on),
    /** Marks packages as seen in the Mod Manager, so they no longer count as new. */
    seen: (ids) => ipcRenderer.invoke('rednode:apps:seen', ids),
    /** Opens the debugger for a package's window: in the game ("overlay", default) or on the desktop. */
    inspect: (id, where) => ipcRenderer.invoke('rednode:apps:inspect', id, where),
    /** Shows a Node mod's window that the player closed. */
    showWindow: (id, win) => ipcRenderer.invoke('rednode:apps:show-window', id, win),
    /** Gets the render path, or sets it to 'gpu' (GPU sharing) or 'cpu'. */
    renderPath: (path) => ipcRenderer.invoke('rednode:host:render-path', path),
    /** Gets hot reload, or turns it on or off. */
    hotReload: (on) => ipcRenderer.invoke('rednode:host:hot-reload', on),
    /** Gets the theme every window follows, or sets it: 'rednode', 'hud' (HUD red) or 'edge' (EDGE). */
    theme: (name) => ipcRenderer.invoke('rednode:host:theme', name),
    /** Grants or withdraws a permission a package asks for, such as 'mcp'. */
    grant: (id, permission, granted) => ipcRenderer.invoke('rednode:apps:grant', id, permission, granted),
    /** Gets the kernel MCP server's switch, or turns it on or off. */
    mcp: (on) => ipcRenderer.invoke('rednode:host:mcp', on),
    /** Copies the command that adds the MCP server to Claude Code. */
    copyMcpCommand: () => ipcRenderer.invoke('rednode:host:mcp-command'),
  },
  /** The mod log, for apps built into REDnode. Other apps get an error. New lines arrive as {event: 'mod-log', entries}. */
  logs: {
    recent: () => ipcRenderer.invoke('rednode:logs:recent'),
    copy: (text) => ipcRenderer.invoke('rednode:logs:copy', text),
  },
  /** This app's own secrets and the kernel's tools; used by `secrets` and `kernel` in the rednode package. */
  pkg: {
    secret: (op, name, value) => ipcRenderer.invoke('rednode:pkg:secret', op, name, value),
    mcp: () => ipcRenderer.invoke('rednode:pkg:mcp'),
    bridge: (op, method, params) => ipcRenderer.invoke('rednode:pkg:bridge', op, method, params),
    requires: () => ipcRenderer.invoke('rednode:pkg:requires'),
    post: (data) => ipcRenderer.send('rednode:pkg:post', data),
  },
  /** Questions to the AI assistant; used by `agent` in the rednode package. Answers arrive as {event: 'agent'}. */
  agent: (msg) => ipcRenderer.send('rednode:agent', msg),
  /** For the host's builder page, which shows windows built by Node mods. Other pages get an error. */
  builder: {
    spec: () => ipcRenderer.invoke('rednode:builder:spec'),
    send: (event) => ipcRenderer.send('rednode:builder:event', event),
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
