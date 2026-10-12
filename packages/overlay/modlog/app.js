// Mod log: shows what every Node mod prints, as it happens.
// Built into the host, so it may use window.rednode.logs.
'use strict';

const MAX = 1000; // lines kept in the page
const $ = (id) => document.getElementById(id);
const box = $('lines');

let all = []; // { time, id, level, text }, oldest first
let filter = null; // a mod id, or null for every mod
let errorsOnly = false;
let paused = false;
let held = []; // lines that arrived while paused
let lastSeq = 0; // the newest line already here: lines can come both in the history and live

const shown = (e) => (!filter || e.id === filter) && (!errorsOnly || e.level === 'error');
const asText = (e) => `${e.time} [${e.id}]${e.level === 'error' ? ' ERROR' : ''} ${e.text}`;

function lineEl(e) {
  const div = document.createElement('div');
  div.className = `line${e.level === 'error' ? ' error' : ''}`;
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = `${e.time} `;
  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = `[${e.id}] `;
  div.append(t, id, document.createTextNode(e.text));
  return div;
}

// Stays at the bottom unless the player scrolled up to read.
const atBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 24;

function count() {
  const n = all.filter(shown).length;
  const pause = paused ? ` · PAUSED${held.length ? ` +${held.length}` : ''}` : '';
  $('count').textContent = `${n} LINE${n === 1 ? '' : 'S'}${pause}`;
}

function render() {
  const lines = all.filter(shown);
  box.replaceChildren(...lines.map(lineEl));
  if (!lines.length) box.innerHTML = '<div class="empty">Nothing to show.</div>';
  box.scrollTop = box.scrollHeight;
  count();
}

// One chip per mod that has printed something, plus All mods.
function chips() {
  const ids = [...new Set(all.map((e) => e.id))].sort();
  const key = ids.join('|');
  const bar = $('mods');
  if (bar.dataset.ids === key) return;
  bar.dataset.ids = key;
  bar.replaceChildren(
    ...[null, ...ids].map((id) => {
      const b = document.createElement('button');
      b.className = `chip${filter === id ? ' on' : ''}`;
      b.textContent = id ?? 'All mods';
      b.addEventListener('click', () => {
        filter = id;
        bar.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
        render();
      });
      return b;
    }),
  );
}

function append(fresh) {
  const entries = fresh.filter((e) => e.seq > lastSeq);
  if (!entries.length) return;
  lastSeq = entries[entries.length - 1].seq;
  all.push(...entries);
  if (all.length > MAX) all = all.slice(-MAX);
  const stick = atBottom();
  const add = entries.filter(shown);
  if (add.length) {
    if (box.querySelector('.empty')) box.replaceChildren();
    box.append(...add.map(lineEl));
    while (box.childElementCount > MAX) box.firstElementChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
  }
  chips();
  count();
}

$('errors').addEventListener('change', (e) => {
  errorsOnly = e.detail.checked;
  render();
});

$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  if (!paused && held.length) {
    const h = held;
    held = [];
    append(h);
  }
  count();
});

$('clear').addEventListener('click', () => {
  all = [];
  held = [];
  chips();
  render();
});

// Copies the lines shown, to paste into a bug report or a chat.
$('copy').addEventListener('click', async () => {
  const lines = all.filter(shown).map(asText);
  if (!lines.length) {
    RednodeUI.notify('Nothing to copy', { title: 'Mod log' });
    return;
  }
  await window.rednode.logs.copy(lines.join('\n'));
  RednodeUI.notify(`${lines.length} line${lines.length === 1 ? '' : 's'} copied. Paste with Ctrl+V.`, {
    title: 'Mod log',
  });
});

window.rednode.on((m) => {
  if (m.event !== 'mod-log') return;
  if (paused) {
    held.push(...m.entries);
    count();
  } else {
    append(m.entries);
  }
});

window.rednode.logs.recent().then(({ entries, file }) => {
  $('file').textContent = `Full log: ${file}`;
  all = entries.slice(-MAX);
  lastSeq = Math.max(lastSeq, entries.length ? entries[entries.length - 1].seq : 0);
  chips();
  render();
});
