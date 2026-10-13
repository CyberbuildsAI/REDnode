// The Mod Manager: every installed package in one table, with search, filters,
// sorting and paging; bulk actions; and the selected package's details. The
// launcher lists only packages pinned to it; this lists them all.
// Uses window.rednode.apps, which the host gives only to the launcher and here.
'use strict';

const $ = (id) => document.getElementById(id);
const PAGE = 14; // rows a page: as many as the window shows without scrolling

const STATUS = {
  starting: 'STARTING',
  running: 'RUNNING',
  stopped: 'OFF',
  crashed: 'CRASHED',
  'not-responding': 'NOT RESPONDING',
};
const KINDS = [
  ['all', 'All'],
  ['app', 'Apps'],
  ['mod', 'Mods'],
  ['hud', 'HUD'],
];
const STATES = [
  ['all', 'Any'],
  ['on', 'On'],
  ['off', 'Off'],
  ['errors', 'Errors'],
  ['new', 'New'],
];

let items = []; // from the host
const view = { search: '', kind: 'all', state: 'all', sort: 'name', desc: false, page: 0 };
const selected = new Set(); // ids ticked for bulk actions
let current = null; // the id shown in the details
const freshThisVisit = new Set(); // new when the Mod Manager listed them; the badge stays until it closes

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
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(label, onClick, variant = 'ghost') {
  const b = document.createElement('rn-button');
  b.textContent = label;
  if (variant) b.setAttribute('variant', variant);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
function toggle(label, checked, onChange, disabled = false) {
  const t = document.createElement('rn-toggle');
  t.setAttribute('label', label);
  if (checked) t.setAttribute('checked', '');
  if (disabled) t.setAttribute('disabled', '');
  t.addEventListener('change', (e) => onChange(e.detail.checked));
  return t;
}

// ---------- what a package is ----------

const kindOf = (i) => (i.kind === 'hud' ? 'hud' : i.mod && !i.app ? 'mod' : 'app');
const kindLabel = (i) => (i.app && i.mod ? 'App + mod' : i.mod ? 'Node mod' : i.kind === 'hud' ? 'HUD widget' : 'App');
function statusOf(i) {
  if (i.mod) return i.mod.status;
  return i.open ? 'open' : 'off';
}
const statusLabel = (i) => (i.mod ? STATUS[i.mod.status] ?? i.mod.status.toUpperCase() : i.open ? 'OPEN' : 'OFF');
const hasError = (i) => !!i.mod && (i.mod.status === 'crashed' || i.mod.status === 'not-responding' || !!i.mod.error);
const processOf = (i) => (!i.mod ? '' : i.mod.shared && i.mod.canShare ? 'shared' : 'own');

const COLUMNS = [
  { key: 'select', label: '', nosort: true },
  { key: 'launcher', label: 'L', title: 'Pinned to the launcher' },
  { key: 'hud', label: 'H', title: 'Pinned to the HUD: stays on screen during gameplay' },
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'status', label: 'Status' },
  { key: 'memory', label: 'Mem' },
  { key: 'version', label: 'Version' },
  { key: 'author', label: 'Author' },
];
const SORT = {
  launcher: (i) => (i.inLauncher ? 0 : 1),
  hud: (i) => (i.onHud ? 0 : 1),
  name: (i) => i.name.toLowerCase(),
  kind: (i) => kindLabel(i),
  status: (i) => statusLabel(i),
  memory: (i) => -(i.mod?.memoryMB ?? 0),
  process: (i) => processOf(i),
  version: (i) => i.version ?? '',
  author: (i) => (i.author ?? '').toLowerCase(),
};

// ---------- filters ----------

function chips(container, options, key) {
  container.replaceChildren(
    ...options.map(([value, label]) => {
      const c = el('button', `chip${view[key] === value ? ' on' : ''}`, label);
      c.addEventListener('click', () => {
        view[key] = value;
        view.page = 0;
        render();
      });
      return c;
    }),
  );
}

function matches(i) {
  const q = view.search.trim().toLowerCase();
  if (q && ![i.name, i.id, i.author, i.description].some((s) => s && s.toLowerCase().includes(q))) return false;
  if (view.kind !== 'all' && kindOf(i) !== view.kind) return false;
  if (view.state === 'on' && !i.open) return false;
  if (view.state === 'off' && i.open) return false;
  if (view.state === 'errors' && !hasError(i)) return false;
  if (view.state === 'new' && !freshThisVisit.has(i.id)) return false;
  return true;
}

// ---------- the table ----------

function renderHead() {
  $('head').replaceChildren(
    ...COLUMNS.map((c) => {
      const th = el('th', c.nosort ? 'nosort' : view.sort === c.key ? 'sorted' : '', c.label);
      if (c.title) th.title = c.title;
      if (c.key === view.sort) th.textContent += view.desc ? ' ▼' : ' ▲';
      if (c.key === 'select') {
        const all = document.createElement('input');
        all.type = 'checkbox';
        const shown = pageItems();
        all.checked = shown.length > 0 && shown.every((i) => selected.has(i.id));
        all.addEventListener('change', () => {
          for (const i of shown) all.checked ? selected.add(i.id) : selected.delete(i.id);
          render();
        });
        th.append(all);
      } else if (!c.nosort) {
        th.addEventListener('click', () => {
          view.desc = view.sort === c.key ? !view.desc : false;
          view.sort = c.key;
          render();
        });
      }
      return th;
    }),
  );
}

function filtered() {
  const list = items.filter(matches);
  const key = SORT[view.sort] ?? SORT.name;
  list.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const r = x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
    return view.desc ? -r : r;
  });
  return list;
}
function pageItems() {
  const list = filtered();
  view.page = Math.min(view.page, Math.max(0, Math.ceil(list.length / PAGE) - 1));
  return list.slice(view.page * PAGE, view.page * PAGE + PAGE);
}

function pinButton(i, where) {
  const on = where === 'launcher' ? i.inLauncher : i.onHud;
  const b = el('button', `pin${on ? ' on' : ''}`, where === 'launcher' ? 'L' : 'H');
  const fixed = where === 'launcher' ? i.builtin : i.kind === 'hud';
  b.disabled = fixed;
  b.title = fixed
    ? where === 'launcher'
      ? 'Built into REDnode: always in the launcher'
      : 'A HUD widget is always on the HUD'
    : `${on ? 'Unpin from' : 'Pin to'} the ${where === 'launcher' ? 'launcher' : 'HUD'}`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    act(i.name, () => window.rednode.apps.pin(i.id, where, !on));
  });
  return b;
}

function renderRows() {
  const shown = pageItems();
  const total = filtered().length;
  $('rows').replaceChildren(
    ...shown.map((i) => {
      const tr = el('tr', i.id === current ? 'selected' : '');
      tr.addEventListener('click', () => {
        current = i.id;
        render();
      });
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = selected.has(i.id);
      tick.addEventListener('click', (e) => e.stopPropagation());
      tick.addEventListener('change', () => {
        tick.checked ? selected.add(i.id) : selected.delete(i.id);
        render();
      });
      const name = el('td', 'name');
      name.append(el('b', '', i.name));
      if (freshThisVisit.has(i.id)) name.append(el('span', 'new', 'NEW'));
      name.title = `${i.name} (${i.id})`;
      const cells = [
        [tick],
        [pinButton(i, 'launcher')],
        [pinButton(i, 'hud')],
        name,
        el('td', 'dim', kindLabel(i)),
        el('td', `mono st-${statusOf(i)}`, statusLabel(i)),
        el('td', 'mono dim', i.mod?.memoryMB ? `${i.mod.memoryMB} MB` : ''),
        el('td', 'mono dim', i.version ?? ''),
        el('td', 'dim', i.builtin ? 'REDnode' : i.author ?? ''),
      ];
      for (const c of cells) {
        if (Array.isArray(c)) {
          const td = el('td');
          td.append(...c);
          tr.append(td);
        } else tr.append(c);
      }
      return tr;
    }),
  );
  $('empty').hidden = shown.length > 0;
  const from = total ? view.page * PAGE + 1 : 0;
  $('range').textContent = `${from}-${view.page * PAGE + shown.length} of ${total}`;
  $('prev').toggleAttribute('disabled', view.page === 0);
  $('next').toggleAttribute('disabled', (view.page + 1) * PAGE >= total);
}

// ---------- bulk actions ----------

function renderBulk() {
  for (const id of [...selected]) if (!items.some((i) => i.id === id)) selected.delete(id);
  $('bulk').hidden = !selected.size;
  $('bulk-count').textContent = `${selected.size} selected:`;
}

const BULK = {
  on: (i) => !i.pinned && window.rednode.apps.setOpen(i.id, true),
  off: (i) => !i.pinned && !i.manager && window.rednode.apps.setOpen(i.id, false),
  launcher: (i) => !i.builtin && window.rednode.apps.pin(i.id, 'launcher', true),
  unlauncher: (i) => !i.builtin && window.rednode.apps.pin(i.id, 'launcher', false),
  hud: (i) => i.kind !== 'hud' && window.rednode.apps.pin(i.id, 'hud', true),
  unhud: (i) => i.kind !== 'hud' && window.rednode.apps.pin(i.id, 'hud', false),
  shared: (i) => i.mod?.canShare && window.rednode.apps.setShared(i.id, true),
  own: (i) => i.mod && window.rednode.apps.setShared(i.id, false),
};
for (const b of document.querySelectorAll('[data-bulk]')) {
  b.addEventListener('click', () => {
    const what = b.dataset.bulk;
    if (what === 'clear') {
      selected.clear();
      render();
      return;
    }
    act('Mod Manager', async () => {
      for (const i of items.filter((x) => selected.has(x.id))) await BULK[what](i);
    });
  });
}

// ---------- details ----------

function shortError(text) {
  const [message, ...stack] = text.split('\n');
  const at = stack.find((l) => /^\s*at /.test(l));
  const where = at && /([^/\\(]+:\d+):\d+\)?\s*$/.exec(at);
  return where ? `${message}\n  at ${where[1]}` : message;
}

function renderDetails() {
  const box = $('details');
  const i = items.find((x) => x.id === current);
  if (!i) {
    box.replaceChildren(el('div', 'dim', 'Select a package to see its details.'));
    return;
  }
  const parts = [];
  parts.push(el('h2', '', i.name));
  parts.push(el('div', 'meta', [kindLabel(i), i.version && `v${i.version}`, i.builtin ? 'built into REDnode' : i.author, i.id].filter(Boolean).join(' · ')));
  if (i.description) parts.push(el('div', 'desc', i.description));

  parts.push(el('div', 'section', 'Switches'));
  if (!i.manager) parts.push(toggle(i.app ? 'Open' : 'Running', i.open, (on) => act(i.name, () => window.rednode.apps.setOpen(i.id, on))));
  parts.push(
    toggle('Pin to launcher', i.inLauncher, (on) => act(i.name, () => window.rednode.apps.pin(i.id, 'launcher', on)), i.builtin),
  );
  parts.push(
    toggle('Pin to HUD', i.onHud, (on) => act(i.name, () => window.rednode.apps.pin(i.id, 'hud', on)), i.kind === 'hud'),
  );
  if (i.mod) {
    parts.push(
      toggle('Shared process', i.mod.shared && i.mod.canShare, (on) => act(i.name, () => window.rednode.apps.setShared(i.id, on)), !i.mod.canShare),
    );
    const row = el('div', 'row');
    row.append(el('span', `mono st-${i.mod.status}`, `${statusLabel(i)} · ${processOf(i)} process${i.mod.memoryMB ? ` · ${i.mod.memoryMB} MB` : ''}`));
    if (i.open) row.append(button('Restart', () => act(i.name, () => window.rednode.apps.restart(i.id))));
    parts.push(row);
  }
  if (i.hasWindow) {
    // Chromium's DevTools for its window: in the game, or on the desktop (Alt+Tab).
    const row = el('div', 'row');
    row.append(el('span', 'dim', 'Inspect'));
    row.append(button('In the game', () => act(i.name, () => window.rednode.apps.inspect(i.id, 'overlay'))));
    row.append(button('On the desktop', () => act(i.name, () => window.rednode.apps.inspect(i.id, 'desktop'))));
    parts.push(row);
  }
  for (const win of i.closedWindows ?? []) {
    const row = el('div', 'row');
    row.append(el('span', 'dim', i.closedWindows.length > 1 ? `Window "${win}" closed` : 'Window closed'));
    row.append(button('Show', () => act(i.name, () => window.rednode.apps.showWindow(i.id, win))));
    parts.push(row);
  }

  if (i.permissions?.length) {
    parts.push(el('div', 'section', 'Permissions'));
    for (const p of i.permissions) {
      parts.push(el('div', 'perm', `Asks for ${p.what}`));
      parts.push(toggle('Allowed', p.granted, (on) => act(i.name, () => window.rednode.apps.grant(i.id, p.name, on))));
    }
  }
  if (i.mod?.error) {
    parts.push(el('div', 'section', 'Last error'));
    parts.push(el('div', 'err', shortError(i.mod.error)));
  }
  if (i.mod?.log?.length) {
    parts.push(el('div', 'section', 'Last lines'));
    parts.push(el('div', 'log', i.mod.log.join('\n')));
  }
  box.replaceChildren(...parts);
}

// ---------- refresh ----------

function render() {
  chips($('kinds'), KINDS, 'kind');
  chips($('states'), STATES, 'state');
  renderHead();
  renderRows();
  renderBulk();
  renderDetails();
  const on = items.filter((i) => i.open).length;
  const errors = items.filter(hasError).length;
  $('summary').textContent = `${items.length} PACKAGES · ${on} ON${errors ? ` · ${errors} WITH ERRORS` : ''}`;
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    items = await window.rednode.apps.list();
    const fresh = items.filter((i) => i.isNew).map((i) => i.id);
    for (const id of fresh) freshThisVisit.add(id);
    if (fresh.length) await window.rednode.apps.seen(fresh); // listed here: no longer "new" in the launcher
    if (current && !items.some((i) => i.id === current)) current = null;
    render();
  } catch (err) {
    RednodeUI.notify(cleanError(err), { type: 'error', title: 'Mod Manager' });
  } finally {
    refreshing = false;
  }
}

// Read from the field itself: the native input event also bubbles out of rn-input, without a detail.
$('search').addEventListener('input', () => {
  view.search = $('search').value ?? '';
  view.page = 0;
  render();
});
$('prev').addEventListener('click', () => {
  view.page = Math.max(0, view.page - 1);
  render();
});
$('next').addEventListener('click', () => {
  view.page += 1;
  render();
});

window.rednode.on((m) => {
  if (m.event === 'apps') refresh();
});
setInterval(refresh, 2000); // memory and state stay current
refresh();
