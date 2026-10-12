// The REDnode launcher: lists installed apps and Node mods, opens or closes
// them, and shows each mod's state, process and memory.
// Uses window.rednode.apps, which the host gives only to the launcher.
'use strict';

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const rows = new Map(); // package id -> { root, update(item) }

const STATUS = {
  starting: 'STARTING',
  running: 'RUNNING',
  stopped: 'OFF',
  crashed: 'CRASHED',
  'not-responding': 'NOT RESPONDING',
};

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function act(name, fn) {
  try {
    await fn();
  } catch (err) {
    RednodeUI.notify(cleanError(err), { type: 'error', title: name });
  }
  refresh();
}

// The message, and where it came from: the first stack line, as file:line.
function shortError(text) {
  const [message, ...stack] = text.split('\n');
  const at = stack.find((l) => /^\s*at /.test(l));
  const where = at && /([^/\\(]+:\d+):\d+\)?\s*$/.exec(at);
  return where ? `${message}\n  at ${where[1]}` : message;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function makeRow(item) {
  const root = el('div', 'app');
  const text = el('div');
  const name = el('div', 'name', item.name);
  const meta = el('div', 'meta');
  text.append(name, meta);

  const open = document.createElement('rn-toggle');
  open.addEventListener('change', (e) => act(item.name, () => window.rednode.apps.setOpen(item.id, e.detail.checked)));
  root.append(text, open);

  if (item.description) root.append(el('div', 'desc', item.description));

  let update;
  if (item.mod) {
    const mod = el('div', 'mod');
    const status = el('div', 'status-line');
    const controls = el('div', 'controls');
    const shared = document.createElement('rn-toggle');
    shared.setAttribute('label', 'Shared process');
    shared.addEventListener('change', (e) =>
      act(item.name, () => window.rednode.apps.setShared(item.id, e.detail.checked)),
    );
    const restart = document.createElement('rn-button');
    restart.setAttribute('variant', 'ghost');
    restart.textContent = 'Restart';
    restart.addEventListener('click', () => act(item.name, () => window.rednode.apps.restart(item.id)));
    controls.append(shared, restart);
    const error = el('div', 'err');
    const logs = el('div', 'log');
    mod.append(status, controls, error, logs);
    root.append(mod);

    update = (it) => {
      const m = it.mod;
      const where = m.shared && m.canShare ? `shared process (${m.processMods} mod${m.processMods === 1 ? '' : 's'})` : 'own process';
      status.replaceChildren(
        el('b', `st st-${m.status}`, STATUS[m.status] ?? m.status.toUpperCase()),
        document.createTextNode(` · ${where}${m.memoryMB ? ` · ${m.memoryMB} MB` : ''}`),
      );
      shared.checked = m.shared && m.canShare;
      if (m.canShare) shared.removeAttribute('disabled');
      else shared.setAttribute('disabled', '');
      restart.hidden = !it.open;
      error.textContent = m.error ? shortError(m.error) : '';
      error.hidden = !m.error;
      logs.textContent = m.log.join('\n');
      logs.hidden = !m.log.length;
    };
  }

  return {
    root,
    update(it) {
      const kind = it.app && it.mod ? 'App + Node mod' : it.mod ? 'Node mod' : it.kind === 'hud' ? 'HUD widget' : 'App';
      meta.textContent = it.builtin
        ? `${kind} · built into REDnode`
        : [kind, it.version && `v${it.version}`, it.author].filter(Boolean).join(' · ');
      open.checked = it.open;
      update?.(it);
    },
  };
}

// GPU sharing on or off. Switching reopens every window.
$('gpu').addEventListener('change', async (e) => {
  const path = await window.rednode.apps.renderPath(e.detail.checked ? 'gpu' : 'cpu');
  $('gpu').checked = path === 'gpu';
  RednodeUI.notify(path === 'gpu' ? 'GPU sharing on' : 'GPU sharing off: CPU path', { title: 'Render path' });
});

// Hot reload: restart a mod, or reload an app, when its files change.
$('hot').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.hotReload(e.detail.checked);
  $('hot').checked = on;
  RednodeUI.notify(on ? 'Mods restart when their files change' : 'Hot reload off', { title: 'Hot reload' });
});

// The kernel MCP server: lets AI agents such as Claude Code use REDnode while the game runs.
$('mcp').addEventListener('change', async (e) => {
  const on = await window.rednode.apps.mcp(e.detail.checked);
  $('mcp').checked = on;
  RednodeUI.notify(on ? 'Claude Code can reach REDnode on this PC' : 'MCP server off', { title: 'MCP server' });
});
$('mcp-copy').addEventListener('click', async () => {
  await window.rednode.apps.copyMcpCommand();
  RednodeUI.notify('Run the copied command once in a terminal to add REDnode to Claude Code', { title: 'MCP server' });
});

// Theme: every window that uses the UI kit follows it, unless the app chose its own.
const themeButtons = [...document.querySelectorAll('[data-theme]')];
function showTheme(name) {
  for (const b of themeButtons) {
    if (b.dataset.theme === name) b.removeAttribute('variant');
    else b.setAttribute('variant', 'ghost');
  }
}
for (const b of themeButtons) {
  b.addEventListener('click', () => act('Theme', async () => showTheme(await window.rednode.apps.theme(b.dataset.theme))));
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    $('gpu').checked = (await window.rednode.apps.renderPath()) === 'gpu';
    $('hot').checked = await window.rednode.apps.hotReload();
    showTheme(await window.rednode.apps.theme());
    $('mcp').checked = await window.rednode.apps.mcp();
    const items = await window.rednode.apps.list();
    const list = $('apps');
    const seen = new Set();
    for (const item of items) {
      seen.add(item.id);
      let row = rows.get(item.id);
      if (!row) {
        row = makeRow(item);
        rows.set(item.id, row);
      }
      row.update(item);
    }
    for (const [id, row] of rows) {
      if (!seen.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
    const order = items.map((i) => rows.get(i.id).root);
    if (order.some((r, i) => list.children[i] !== r)) list.replaceChildren(...order);
    if (!items.length) list.innerHTML = '<p class="empty">Nothing installed.</p>';
    $('count').textContent = `· ${items.filter((a) => a.open).length}/${items.length}`;
  } finally {
    refreshing = false;
  }
}

$('toggle').addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) refresh();
});

// Keep memory and state current while the list is open.
setInterval(() => {
  if (!panel.hidden) refresh();
}, 2000);

function showLink(on) {
  $('link').textContent = on ? 'LINKED' : 'OFF';
  $('link').className = on ? '' : 'off';
}

window.rednode.on((m) => {
  if (m.event === 'apps') refresh();
  if (m.event === 'state') showLink(m.state.connected);
});

window.rednode.state().then((s) => showLink(s.connected));
refresh();
