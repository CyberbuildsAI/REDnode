// Generates the game API reference into docs/game/ from gameapi/<game>/rtti.json
// and the hand-written notes in gameapi/notes/.
//
//   npm run docs:game             # newest game version in gameapi/
//   npm run docs:game -- 2.31     # a specific one
//
// Output is static HTML in the house HUD style. Jekyll copies it as-is.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(repo, 'docs', 'game');

// ---------- inputs ----------

const versions = readdirSync(join(repo, 'gameapi'))
  .filter((d) => existsSync(join(repo, 'gameapi', d, 'rtti.json')))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const game = process.argv[2] ?? versions.at(-1);
if (!game) throw new Error('no gameapi/<version>/rtti.json found');
const data = JSON.parse(readFileSync(join(repo, 'gameapi', game, 'rtti.json'), 'utf8'));

const config = readFileSync(join(repo, 'docs', '_config.yml'), 'utf8').replace(/\r\n/g, '\n');
const baseurl = (config.match(/^baseurl:\s*(\S+)/m)?.[1] ?? '').replace(/\/$/, '');
const repoUrl = config.match(/^repo:\s*(\S+)/m)?.[1] ?? '';
const nav = [...config.matchAll(/- title:\s*(.+)\n\s+url:\s*(\S+)/g)].map((m) => ({ title: m[1].trim(), url: m[2] }));

// Notes: gameapi/notes/<NativeName>.md. Text before the first "## " is the
// type note. Each "## Member" section is the note for that property or method.
const notes = new Map();
const notesDir = join(repo, 'gameapi', 'notes');
if (existsSync(notesDir)) {
  for (const file of readdirSync(notesDir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const text = readFileSync(join(notesDir, file), 'utf8').replace(/\r\n/g, '\n').replace(/^# .*\n/, '');
    const [intro, ...sections] = text.split(/^## /m);
    const members = new Map();
    for (const s of sections) {
      const nl = s.indexOf('\n');
      members.set(s.slice(0, nl).trim(), s.slice(nl + 1).trim());
    }
    notes.set(file.slice(0, -3), { intro: intro.trim(), members, file });
  }
}

// ---------- model ----------

const types = new Map(); // native name -> { kind, item, display, slug }
const usedSlugs = new Set();
function slugFor(name) {
  // Pages must not collide on case-insensitive file systems.
  let slug = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  let n = 1;
  while (usedSlugs.has(slug.toLowerCase())) slug = `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}-${++n}`;
  usedSlugs.add(slug.toLowerCase());
  return slug;
}

const children = new Map();
for (const c of data.classes) {
  if (c.parent) (children.get(c.parent) ?? children.set(c.parent, []).get(c.parent)).push(c.name);
}
const byName = new Map(data.classes.map((c) => [c.name, c]));
function derivesFrom(c, base) {
  let cur = c;
  const seen = new Set();
  while (cur && !seen.has(cur.name)) {
    if (cur.name === base) return true;
    seen.add(cur.name);
    cur = byName.get(cur.parent);
  }
  return false;
}
// class: in the IScriptable tree, so scripts can hold references to it.
// native class: an ISerializable engine type outside that tree.
// struct: everything else, plus scripted structs. Value types.
function classKind(c) {
  if (c.flags.includes('scriptedStruct')) return 'struct';
  if (derivesFrom(c, 'IScriptable')) return 'class';
  if (derivesFrom(c, 'ISerializable')) return 'native class';
  return 'struct';
}

for (const c of data.classes) types.set(c.name, { kind: classKind(c), item: c, display: c.scriptName ?? c.name });
for (const e of data.enums) types.set(e.name, { kind: 'enum', item: e, display: e.scriptName ?? e.name });
for (const b of data.bitfields) types.set(b.name, { kind: 'bitfield', item: b, display: b.scriptName ?? b.name });
for (const name of [...types.keys()].sort()) types.get(name).slug = slugFor(name);

// ---------- html helpers ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const anchor = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_');

// RTTI type name -> redscript-style HTML with links, e.g. "handle:gameObject" -> ref<GameObject>
const wrappers = { handle: 'ref', whandle: 'wref', array: 'array', script_ref: 'script_ref' };
function typeHtml(name, rel) {
  if (!name) return '<span class="t-void">Void</span>';
  const fixed = name.match(/^\[(\d+)\](.+)$/);
  if (fixed) return `array&lt;${typeHtml(fixed[2], rel)}&gt;<span class="t-dim">[${fixed[1]}]</span>`;
  const colon = name.indexOf(':');
  if (colon > 0) {
    const prefix = name.slice(0, colon);
    return `${esc(wrappers[prefix] ?? prefix)}&lt;${typeHtml(name.slice(colon + 1), rel)}&gt;`;
  }
  const t = types.get(name);
  if (!t) return `<span class="t-prim">${esc(name)}</span>`;
  const title = t.display !== name ? ` title="native: ${esc(name)}"` : '';
  return `<a class="t-${t.kind.replace(' ', '-')}" href="${rel}t/${t.slug}.html"${title}>${esc(t.display)}</a>`;
}

function badges(flags, skip = []) {
  return flags
    .filter((f) => !skip.includes(f))
    .map((f) => `<span class="badge b-${esc(f)}">${esc(f)}</span>`)
    .join('');
}

const VIS = ['public', 'protected', 'private'];
function funcSignature(f, rel) {
  const words = [];
  const vis = f.flags.find((x) => VIS.includes(x));
  if (vis) words.push(vis);
  if (f.flags.includes('static')) words.push('static');
  if (f.flags.includes('final')) words.push('final');
  if (f.flags.includes('native')) words.push('native');
  if (f.flags.includes('const')) words.push('const');
  words.push(f.flags.includes('event') ? 'cb func' : 'func');
  const params = f.params
    .map((p) => {
      const mods = [p.flags.includes('out') && 'out', p.flags.includes('optional') && 'opt'].filter(Boolean);
      return `${mods.map((m) => `<span class="kw">${m}</span> `).join('')}${esc(p.name)}: ${typeHtml(p.type, rel)}`;
    })
    .join(', ');
  const ret = f.returns ? ` -&gt; ${typeHtml(f.returns, rel)}` : '';
  return `<span class="kw">${words.join(' ')}</span> <b class="fn">${esc(f.name)}</b>(${params})${ret}`;
}

// Flags not already spelled out in the signature, shown at the end of its line.
function fnBadges(f) {
  const rest = badges(f.flags, [...VIS, 'static', 'final', 'native', 'const', 'event']);
  return rest ? `<span class="fl">${rest}</span>` : '';
}

const md = (text) => marked.parse(text, { async: false });

function page({ title, rel, crumb, body, source }) {
  const navHtml = nav
    .map((n) => {
      const href = n.url === '/' ? `${baseurl}/` : baseurl + n.url;
      const current = n.url.startsWith('/game/') ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${esc(n.title)}</a>`;
    })
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · Game API · REDnode</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Rajdhani:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel}../assets/css/hud.css">
<link rel="stylesheet" href="${rel}assets/gameapi.css">
<script src="${rel}assets/search.js" defer></script>
</head>
<body data-root="${rel}">

<div class="bar"><div class="wrap">
  <a class="home" href="${baseurl}/"><span class="dot"></span><b>REDNODE</b> / GAME API</a>
  <nav>${navHtml}</nav>
</div></div>

<main class="wrap doc gameapi">
<div class="ga-top">
  <div class="crumb">${crumb}</div>
  <div class="ga-search" role="search">
    <input type="search" placeholder="Search ${(types.size + data.functions.length).toLocaleString('en')} types and functions" aria-label="Search the game API" autocomplete="off" spellcheck="false">
    <ol class="ga-results" hidden></ol>
  </div>
</div>
${body.replace(/<table/g, '<div class="ga-scroll"><table').replace(/<\/table>/g, '</table></div>')}
</main>

<footer class="wrap">
  <span>DATA: GAME ${esc(game)} RTTI, BASE GAME ONLY${source ? ` &middot; NOTES: <a href="${repoUrl}/blob/main/gameapi/notes/${esc(source)}">gameapi/notes/${esc(source)}</a>` : ''}</span>
  <span>REDNODE &middot; MIT</span>
</footer>

</body>
</html>
`;
}

function noteHtml(text) {
  return text ? `<div class="note">${md(text)}</div>` : '';
}

// ---------- type pages ----------

function chain(c) {
  const out = [];
  let cur = c;
  const seen = new Set();
  while (cur?.parent && !seen.has(cur.name)) {
    seen.add(cur.name);
    out.unshift(cur.parent);
    cur = byName.get(cur.parent);
  }
  return out;
}

const listFor = {
  class: { file: 'classes.html', title: 'Classes' },
  'native class': { file: 'native-classes.html', title: 'Native classes' },
  struct: { file: 'structs.html', title: 'Structs' },
};

function classPage(t) {
  const c = t.item;
  const rel = '../';
  const note = notes.get(c.name);
  const kindLabel = `${c.flags.includes('abstract') ? 'abstract ' : ''}${t.kind}`;
  const parts = [];

  parts.push(`<h1>${esc(t.display)}</h1>`);
  const sub = [`<span class="kind">${esc(kindLabel)}</span>`];
  if (t.display !== c.name) sub.push(`<span class="native">native name <code>${esc(c.name)}</code></span>`);
  parts.push(`<p class="ga-sub">${sub.join('')}${badges(c.flags, ['abstract'])}</p>`);

  const parents = chain(c);
  if (parents.length) {
    parts.push(
      `<p class="ga-chain"><span class="lbl">extends</span> ${[...parents].reverse().map((p) => typeHtml(p, rel)).join(' <span class="t-dim">&rsaquo;</span> ')}</p>`,
    );
  }
  const kids = (children.get(c.name) ?? []).slice().sort((a, b) => types.get(a).display.localeCompare(types.get(b).display));
  if (kids.length) {
    parts.push(
      `<details class="ga-kids"${kids.length <= 12 ? ' open' : ''}><summary>Extended by ${kids.length.toLocaleString('en')} ${kids.length === 1 ? 'type' : 'types'}</summary><p>${kids.map((k) => typeHtml(k, rel)).join(' ')}</p></details>`,
    );
  }

  if (note) parts.push(noteHtml(note.intro));

  if (c.props.length) {
    parts.push(`<h2 id="properties">Properties <small>${c.props.length}</small></h2>`);
    parts.push('<table class="ga-props"><thead><tr><th>Name</th><th>Type</th><th>Flags</th></tr></thead><tbody>');
    for (const p of [...c.props].sort((a, b) => a.name.localeCompare(b.name))) {
      const n = note?.members.get(p.name);
      parts.push(
        `<tr id="${anchor(p.name)}"><td><code>${esc(p.name)}</code></td><td class="sig">${typeHtml(p.type, rel)}</td><td>${badges(p.flags, ['handle'])}</td></tr>`,
      );
      if (n) parts.push(`<tr class="note-row"><td colspan="3">${md(n)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  }

  if (c.funcs.length) {
    const sorted = [...c.funcs].sort((a, b) => a.name.localeCompare(b.name) || a.fullName.localeCompare(b.fullName));
    parts.push(`<h2 id="methods">Methods <small>${c.funcs.length}</small></h2>`);
    for (const f of sorted) {
      const n = note?.members.get(f.name);
      parts.push(
        `<div class="ga-fn${n ? ' has-note' : ''}" id="${anchor(f.fullName)}"><pre class="sig">${funcSignature(f, rel)}${fnBadges(f)}</pre>${n ? noteHtml(n) : ''}</div>`,
      );
    }
  }

  if (!c.props.length && !c.funcs.length) parts.push('<p class="t-dim">No properties or methods of its own.</p>');

  return page({
    title: t.display,
    rel,
    crumb: `<a href="${rel}index.html">Game API</a> / <a href="${rel}${listFor[t.kind].file}">${listFor[t.kind].title}</a>`,
    body: parts.join('\n'),
    source: note?.file,
  });
}

function enumPage(t) {
  const e = t.item;
  const rel = '../';
  const note = notes.get(e.name);
  const isBits = t.kind === 'bitfield';
  const rows = isBits ? e.bits.map((b) => ({ name: b.name, value: `bit ${b.bit}` })) : e.members.map((m) => ({ name: m.name, value: m.value, sort: m.value }));
  if (!isBits) rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const parts = [`<h1>${esc(t.display)}</h1>`];
  const sub = [`<span class="kind">${t.kind}</span>`];
  if (t.display !== e.name) sub.push(`<span class="native">native name <code>${esc(e.name)}</code></span>`);
  sub.push(`<span class="native">${e.size} ${e.size === 1 ? 'byte' : 'bytes'}</span>`);
  parts.push(`<p class="ga-sub">${sub.join('')}${badges(e.flags)}</p>`);
  if (note) parts.push(noteHtml(note.intro));
  parts.push(`<h2 id="${isBits ? 'bits' : 'members'}">${isBits ? 'Bits' : 'Members'} <small>${rows.length}</small></h2>`);
  parts.push(`<table><thead><tr><th>Name</th><th>${isBits ? 'Bit' : 'Value'}</th></tr></thead><tbody>`);
  for (const r of rows) {
    const n = note?.members.get(r.name);
    parts.push(`<tr id="${anchor(r.name)}"><td><code>${esc(r.name)}</code></td><td class="num">${esc(r.value)}</td></tr>`);
    if (n) parts.push(`<tr class="note-row"><td colspan="2">${md(n)}</td></tr>`);
  }
  parts.push('</tbody></table>');
  return page({
    title: t.display,
    rel,
    crumb: `<a href="${rel}index.html">Game API</a> / <a href="${rel}enums.html">Enums</a>`,
    body: parts.join('\n'),
    source: note?.file,
  });
}

// ---------- list pages ----------

function letterList(items, rel) {
  const groups = new Map();
  for (const it of items) {
    const ch = /^[A-Za-z]/.test(it.display) ? it.display[0].toUpperCase() : '#';
    (groups.get(ch) ?? groups.set(ch, []).get(ch)).push(it);
  }
  const keys = [...groups.keys()].sort();
  const jump = `<p class="ga-jump">${keys.map((k) => `<a href="#l-${k === '#' ? 'sym' : k}">${k}</a>`).join('')}</p>`;
  const body = keys
    .map((k) => {
      const list = groups.get(k).sort((a, b) => a.display.localeCompare(b.display));
      return `<h3 id="l-${k === '#' ? 'sym' : k}">${k} <small>${list.length}</small></h3><ul class="ga-list">${list
        .map((t) => `<li><a class="t-${t.kind.replace(' ', '-')}" href="${rel}t/${t.slug}.html">${esc(t.display)}</a>${t.display !== t.item.name ? `<span class="t-dim"> ${esc(t.item.name)}</span>` : ''}</li>`)
        .join('')}</ul>`;
    })
    .join('\n');
  return jump + body;
}

function listPage(file, title, intro, items) {
  const rel = '';
  return [
    file,
    page({
      title,
      rel,
      crumb: `<a href="index.html">Game API</a>`,
      body: `<h1>${esc(title)}</h1>\n<p>${intro}</p>\n${letterList(items, rel)}`,
    }),
  ];
}

function functionsPage() {
  const rel = '';
  const fns = [...data.functions].sort((a, b) => a.name.localeCompare(b.name) || a.fullName.localeCompare(b.fullName));
  const groups = new Map();
  for (const f of fns) {
    const ch = /^[A-Za-z]/.test(f.name) ? f.name[0].toUpperCase() : '#';
    (groups.get(ch) ?? groups.set(ch, []).get(ch)).push(f);
  }
  const keys = [...groups.keys()].sort();
  const body = [
    '<h1>Global functions</h1>',
    `<p>${fns.length.toLocaleString('en')} functions that belong to no class. Script code calls them by name.</p>`,
    `<p class="ga-jump">${keys.map((k) => `<a href="#l-${k === '#' ? 'sym' : k}">${k}</a>`).join('')}</p>`,
    ...keys.map(
      (k) =>
        `<h3 id="l-${k === '#' ? 'sym' : k}">${k} <small>${groups.get(k).length}</small></h3>` +
        groups
          .get(k)
          .map((f) => `<div class="ga-fn" id="${anchor(f.fullName)}"><pre class="sig">${funcSignature(f, rel)}${fnBadges(f)}</pre></div>`)
          .join(''),
    ),
  ].join('\n');
  return ['functions.html', page({ title: 'Global functions', rel, crumb: '<a href="index.html">Game API</a>', body })];
}

function indexPage(counts) {
  const rel = '';
  const card = (href, label, n, text) =>
    `<a class="ga-card" href="${href}"><span class="n">${n.toLocaleString('en')}</span><span class="l">${label}</span><span class="d">${text}</span></a>`;
  const body = `<h1>Game API</h1>
<p>Every class, struct, enum and global function the game exposes to scripts and native plugins, read from the game's own type data (RTTI). Signatures are shown in redscript syntax. Hover a linked type to see its native name.</p>
<div class="ga-cards">
${card('classes.html', 'Classes', counts.classes, 'Script-facing reference types, the IScriptable tree')}
${card('structs.html', 'Structs', counts.structs, 'Value types')}
${card('native-classes.html', 'Native classes', counts.nativeClasses, 'Engine types outside the IScriptable tree')}
${card('enums.html', 'Enums and bitfields', counts.enums, 'Named constants')}
${card('functions.html', 'Global functions', counts.functions, 'Free functions')}
</div>
<h2>About this data</h2>
<table>
<thead><tr><th>Item</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Game version</td><td>${esc(data.game)}</td></tr>
<tr><td>Scope</td><td>Base game only. Dumped with no mods loaded except RED4ext and REDnode, so no mod adds types or methods here.</td></tr>
<tr><td>Dumped by</td><td>${esc(data.dumper)} on ${esc(data.imported)}</td></tr>
<tr><td>Totals</td><td>${counts.props.toLocaleString('en')} properties, ${counts.methods.toLocaleString('en')} methods</td></tr>
</tbody>
</table>
<p>The type data carries names, types and flags only. Descriptions come from REDnode's own notes in <a href="${repoUrl}/tree/main/gameapi/notes"><code>gameapi/notes/</code></a>. Types with notes: ${counts.noted}.</p>
<h3>Flags</h3>
<table>
<thead><tr><th>Flag</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td><span class="badge b-native">native</span></td><td>Implemented in the game's C++ code</td></tr>
<tr><td><span class="badge b-scripted">scripted</span></td><td>Defined in the game's redscript code</td></tr>
<tr><td><span class="badge b-importOnly">importOnly</span></td><td>A native type that scripts may use but not subclass</td></tr>
<tr><td><code>cb func</code></td><td>An event callback (flag <code>event</code>). The game calls it</td></tr>
<tr><td><span class="badge b-exec">exec</span></td><td>A console command</td></tr>
<tr><td><span class="badge b-quest">quest</span></td><td>Callable from quest scripts</td></tr>
</tbody>
</table>
<p class="t-dim">The split into classes, native classes and structs is inferred from the inheritance tree: <code>IScriptable</code> descendants are classes, other <code>ISerializable</code> descendants are native classes, and the rest are structs. It is <strong>unverified</strong> for edge cases.</p>`;
  return ['index.html', page({ title: 'Game API', rel, crumb: 'Game API', body })];
}

// ---------- write ----------

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 't'), { recursive: true });
cpSync(join(here, 'assets'), join(outDir, 'assets'), { recursive: true });

const all = [...types.values()];
for (const t of all) {
  const html = t.kind === 'enum' || t.kind === 'bitfield' ? enumPage(t) : classPage(t);
  writeFileSync(join(outDir, 't', `${t.slug}.html`), html);
}

const classes = all.filter((t) => t.kind === 'class');
const structs = all.filter((t) => t.kind === 'struct');
const nativeClasses = all.filter((t) => t.kind === 'native class');
const enums = all.filter((t) => t.kind === 'enum' || t.kind === 'bitfield');
const pages = [
  listPage('classes.html', 'Classes', `${classes.length.toLocaleString('en')} classes. Each derives from <code>IScriptable</code> and is passed by reference.`, classes),
  listPage('structs.html', 'Structs', `${structs.length.toLocaleString('en')} structs. Value types, copied when passed.`, structs),
  listPage('native-classes.html', 'Native classes', `${nativeClasses.length.toLocaleString('en')} engine classes that derive from <code>ISerializable</code> but not <code>IScriptable</code>, such as resources and component data. Scripts rarely touch them directly.`, nativeClasses),
  listPage('enums.html', 'Enums and bitfields', `${data.enums.length.toLocaleString('en')} enums and ${data.bitfields.length} bitfields.`, enums),
  functionsPage(),
  indexPage({
    classes: classes.length,
    structs: structs.length,
    nativeClasses: nativeClasses.length,
    enums: enums.length,
    functions: data.functions.length,
    props: data.classes.reduce((n, c) => n + c.props.length, 0),
    methods: data.classes.reduce((n, c) => n + c.funcs.length, 0),
    noted: notes.size,
  }),
];
for (const [file, html] of pages) writeFileSync(join(outDir, file), html);

// Search index: [display, native or "", kind, url]. Kind: c s e b f.
const kindCode = { class: 'c', 'native class': 'n', struct: 's', enum: 'e', bitfield: 'b' };
const index = all
  .map((t) => [t.display, t.display !== t.item.name ? t.item.name : '', kindCode[t.kind], `t/${t.slug}.html`])
  .concat(data.functions.map((f) => [f.name, '', 'f', `functions.html#${anchor(f.fullName)}`]));
writeFileSync(join(outDir, 'search-index.json'), JSON.stringify(index));

const unknownNotes = [...notes.keys()].filter((n) => !types.has(n));
if (unknownNotes.length) console.warn(`Notes for unknown types: ${unknownNotes.join(', ')}`);
console.log(`Game API ${game}: ${all.length} type pages, ${data.functions.length} functions -> docs/game/`);
