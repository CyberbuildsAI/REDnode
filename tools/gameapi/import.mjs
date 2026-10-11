// Imports an RTTI dump written by the REDnode plugin into gameapi/<game>/rtti.json.
//
//   node tools/gameapi/import.mjs <path to rtti-dump.json> --game 2.31
//
// The dump must come from a base-game run (only RED4ext and REDnode loaded).
// See docs/dev-setup.md, "Game API reference".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const gameIdx = args.indexOf('--game');
const game = gameIdx >= 0 ? args[gameIdx + 1] : undefined;
const source = args.find((a, i) => !a.startsWith('--') && i !== gameIdx + 1);
if (!source || !game) {
  console.error('usage: node tools/gameapi/import.mjs <rtti-dump.json> --game <version, e.g. 2.31>');
  process.exit(1);
}

const dump = JSON.parse(readFileSync(source, 'utf8'));
if (dump.format !== 1) throw new Error(`unsupported dump format ${dump.format}`);

// Fixes for dumps from REDnode 0.2.0:
// - it labelled the "scripted function" bit as "threadsafe";
// - it wrote the name "None" as an empty string.
const none = (s) => (s === '' ? 'None' : s);
const fixProp = (p) => ({ ...p, name: none(p.name) });
const fixFunc = (f) => ({
  ...f,
  name: none(f.name),
  fullName: none(f.fullName),
  flags: f.flags.map((x) => (x === 'threadsafe' ? 'scripted' : x)),
  params: f.params.map(fixProp),
});

const out = {
  format: 1,
  game,
  runtime: dump.game,
  dumper: dump.dumper,
  imported: new Date().toISOString().slice(0, 10),
  scope: 'base game: only RED4ext and REDnode loaded',
  classes: dump.classes.map((c) => ({ ...c, props: c.props.map(fixProp), funcs: c.funcs.map(fixFunc) })),
  enums: dump.enums.map((e) => ({ ...e, members: e.members.map((m) => ({ ...m, name: none(m.name) })) })),
  bitfields: dump.bitfields.map((b) => ({ ...b, bits: b.bits.map((x) => ({ ...x, name: none(x.name) })) })),
  functions: dump.functions.map(fixFunc),
};

const leaks = JSON.stringify(out.functions).match(/"REDnode_/g);
if (leaks) throw new Error('dump contains REDnode functions');

// One entry per line, so git diffs between game versions stay readable.
const lines = ['{'];
const head = ['format', 'game', 'runtime', 'dumper', 'imported', 'scope'];
for (const key of head) lines.push(`${JSON.stringify(key)}:${JSON.stringify(out[key])},`);
const lists = ['classes', 'enums', 'bitfields', 'functions'];
lists.forEach((key, i) => {
  lines.push(`${JSON.stringify(key)}:[`);
  lines.push(out[key].map((x) => JSON.stringify(x)).join(',\n'));
  lines.push(i === lists.length - 1 ? ']' : '],');
});
lines.push('}');

const target = join(repo, 'gameapi', game, 'rtti.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join('\n') + '\n');

console.log(
  `Imported game ${game}: ${out.classes.length} classes, ${out.enums.length} enums, ` +
    `${out.bitfields.length} bitfields, ${out.functions.length} functions -> ${target}`,
);
