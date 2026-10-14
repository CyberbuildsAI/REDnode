// Generates TypeScript types for the generic game API from the game's type data.
//
//   node tools/gameapi/types.mjs            (run by the rednode package's build)
//
// Reads gameapi/<version>/rtti.json and writes
// packages/rednode/src/generated/game.d.ts, which types `api` in the rednode
// package: every global function, every class's static functions, every
// object's methods, structs as objects and enums as unions of member names.
// The output is derived from the game, so it is not committed (.gitignore).

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const versions = readdirSync(join(repo, 'gameapi'))
  .filter((d) => /^\d/.test(d) && statSync(join(repo, 'gameapi', d)).isDirectory())
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const version = versions.at(-1);
const data = JSON.parse(readFileSync(join(repo, 'gameapi', version, 'rtti.json'), 'utf8'));
const outFile = join(repo, 'packages', 'rednode', 'src', 'generated', 'game.d.ts');
const distFile = join(repo, 'packages', 'rednode', 'dist', 'generated', 'game.d.ts');

const classes = new Map(data.classes.map((c) => [c.name, c]));
const enums = new Map(data.enums.map((e) => [e.name, e]));
const bitfields = new Set(data.bitfields.map((b) => b.name));
const scriptToNative = new Map(data.classes.filter((c) => c.scriptName).map((c) => [c.scriptName, c.name]));

// ---------- names ----------

const RESERVED = new Set(
  ('break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'as implements interface let package private protected public static yield await any boolean number string ' +
    'symbol unknown never object undefined').split(' '),
);
// Global TypeScript names a game type must not shadow inside the generated file.
const GLOBALS = new Set(['Promise', 'Array', 'Record', 'Partial', 'Object', 'String', 'Number', 'Boolean', 'Function',
  'Symbol', 'Date', 'Error', 'Map', 'Set', 'WeakRef', 'JSON', 'Math', 'GameRef', 'GameApi']);

const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
const key = (s) => (isIdent(s) ? s : JSON.stringify(s));
const typeName = (s) => {
  const t = s.replace(/[^\w$]/g, '_');
  return GLOBALS.has(t) ? `Game_${t}` : t;
};
const paramName = (s, i) => {
  const t = (s || `arg${i}`).replace(/[^\w$]/g, '_');
  return RESERVED.has(t) || !isIdent(t) ? `${t}_` : t;
};

// ---------- types ----------

const scriptableCache = new Map();
function isScriptable(name) {
  if (scriptableCache.has(name)) return scriptableCache.get(name);
  let c = classes.get(name);
  let result = false;
  for (let guard = 0; c && guard < 64; guard += 1) {
    if (c.name === 'IScriptable') {
      result = true;
      break;
    }
    c = c.parent ? classes.get(c.parent) : null;
  }
  scriptableCache.set(name, result);
  return result;
}

const NUMBER = new Set(['Int8', 'Int16', 'Int32', 'Uint8', 'Uint16', 'Uint32', 'Float', 'Double']);
const STRING = new Set(['Int64', 'Uint64', 'CRUID', 'CName', 'String', 'TweakDBID']);

const paren = (t) => (t.includes('|') ? `(${t})` : t);

// aIn: a parameter (structs may be partial or null); otherwise a value the game returns.
function tsType(t, aIn = false) {
  let m = /^\[(\d+)\](.*)$/.exec(t);
  if (m) return `${paren(tsType(m[2], aIn))}[]`;
  m = /^static:\d+,(.*)$/.exec(t);
  if (m) return `${paren(tsType(m[1], aIn))}[]`;
  const colon = t.indexOf(':');
  if (colon > 0) {
    const kind = t.slice(0, colon);
    const inner = t.slice(colon + 1);
    if (kind === 'handle' || kind === 'whandle') {
      return isScriptable(inner) ? `${typeName(inner)} | null` : 'unknown';
    }
    if (kind === 'array') return `${paren(tsType(inner, aIn))}[]`;
    return 'unknown'; // script_ref, resource references, curves
  }
  if (t === 'Bool') return 'boolean';
  if (NUMBER.has(t)) return 'number';
  if (STRING.has(t)) return 'string';
  if (enums.has(t)) return typeName(t);
  if (bitfields.has(t)) return 'number';
  if (classes.has(t)) {
    if (isScriptable(t)) return 'unknown'; // objects never travel by value
    return aIn ? `Partial<${typeName(t)}> | null` : typeName(t);
  }
  return 'string'; // other simple types travel as their text form
}

function signature(f) {
  const out = f.params.filter((p) => p.flags.includes('out'));
  let optional = false;
  const params = f.params.map((p, i) => {
    optional ||= p.flags.includes('optional') || p.flags.includes('out');
    const t = p.type.startsWith('script_ref:') ? 'unknown' : tsType(p.type, true);
    return `${paramName(p.name, i)}${optional ? '?' : ''}: ${t}`;
  });
  let ret = f.returns ? tsType(f.returns) : 'void';
  if (out.length) {
    const fields = out.map((p) => `${key(p.name)}: ${tsType(p.type)}`).join('; ');
    ret = `{ result: ${ret}; out: { ${fields} } }`;
  }
  return `(${params.join(', ')}): Promise<${ret}>`;
}

// Every instance method named aName in aClass and its ancestors.
function inheritedMethods(aClass, aName) {
  const found = [];
  for (let c = aClass && classes.get(aClass), guard = 0; c && guard < 64; c = classes.get(c.parent), guard += 1) {
    for (const f of c.funcs) if (f.name === aName && !f.flags.includes('static')) found.push(f);
  }
  return found;
}

function doc(f, owner) {
  const flags = f.flags.filter((x) => ['native', 'scripted', 'const'].includes(x)).join(', ');
  return `  /** ${owner ? `${owner}.` : ''}${f.fullName}${flags ? ` (${flags})` : ''} */`;
}

// ---------- output ----------

const lines = [];
const w = (s = '') => lines.push(s);

w(`// Generated by tools/gameapi/types.mjs from gameapi/${version}/rtti.json. Do not edit.`);
w('// Types for `api` in the rednode package: the generic game API. See docs/overlay-apps.md.');
w('');
w("import type { GameRef } from '../api.js';");
w('');

// Enums
for (const e of data.enums) {
  const members = e.members.map((m) => JSON.stringify(m.name));
  w(`export type ${typeName(e.name)} = ${members.length ? members.join(' | ') : 'string'};`);
}
w('');

// Classes: objects (methods) and structs (properties)
const staticsOf = new Map(); // class native name -> [function]
for (const c of data.classes) {
  const name = typeName(c.name);
  const parent = c.parent && classes.has(c.parent) ? typeName(c.parent) : null;
  if (isScriptable(c.name)) {
    const ext = c.name === 'IScriptable' ? 'GameRef' : parent ?? 'GameRef';
    w(`/** ${c.name}${c.scriptName ? ` (${c.scriptName} in scripts)` : ''} */`);
    w(`export interface ${name} extends ${ext} {`);
    const own = c.funcs.filter((f) => !f.flags.includes('static'));
    for (const f of own) {
      w(doc(f));
      w(`  ${key(f.name)}${signature(f)};`);
    }
    // An override with a different signature would not type-check against its base,
    // so the inherited signatures of an overridden name are listed too, as overloads.
    const seen = new Set(own.map((f) => `${f.name}${signature(f)}`));
    for (const f of own) {
      for (const g of inheritedMethods(c.parent, f.name)) {
        const sig = `${g.name}${signature(g)}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        w(`  ${key(g.name)}${signature(g)};`);
      }
    }
    w('}');
  } else {
    w(`/** ${c.name}${c.scriptName ? ` (${c.scriptName} in scripts)` : ''}: a struct, passed by value */`);
    w(`export interface ${name}${parent && !isScriptable(c.parent) ? ` extends ${parent}` : ''} {`);
    for (const p of c.props) w(`  ${key(p.name)}: ${tsType(p.type)};`);
    w('}');
  }
  const statics = c.funcs.filter((f) => f.flags.includes('static'));
  if (statics.length) staticsOf.set(c.name, [...statics]);
}
w('');

// Static functions of script classes are registered as globals named "Class::Name;...".
const globals = [];
for (const f of data.functions) {
  const at = f.fullName.indexOf('::');
  if (at < 0) {
    globals.push(f);
    continue;
  }
  const owner = f.fullName.slice(0, at);
  const native = classes.has(owner) ? owner : scriptToNative.get(owner);
  if (!native) continue;
  if (!staticsOf.has(native)) staticsOf.set(native, []);
  staticsOf.get(native).push(f);
}

const namespaces = [];
for (const [native, funcs] of staticsOf) {
  const c = classes.get(native);
  const iface = `Statics_${typeName(native)}`;
  w(`/** Static functions of ${native}${c.scriptName ? ` (${c.scriptName} in scripts)` : ''} */`);
  w(`export interface ${iface} {`);
  for (const f of funcs) {
    w(doc(f, c.scriptName ?? native));
    w(`  ${key(f.name)}${signature(f)};`);
  }
  w('}');
  namespaces.push([c.scriptName ?? native, iface]);
}
w('');

// TweakDB record types, for the tweakdb module: the native name and the short name
// (gamedataVehicle_Record and Vehicle) both map to the record's interface.
function isRecord(name) {
  for (let n = name; n; n = classes.get(n)?.parent) if (n === 'gamedataTweakDBRecord') return true;
  return false;
}
const records = data.classes.filter((c) => isRecord(c.name));
w('/** TweakDB record types by name, for `tweakdb` in the rednode package: native names and short names. */');
w('export interface RecordTypes {');
const recordKeys = new Set();
for (const c of records) {
  const short = c.name.replace(/^gamedata/, '').replace(/_Record$/, '');
  for (const k of [c.name, short]) {
    if (recordKeys.has(k)) continue;
    recordKeys.add(k);
    w(`  ${key(k)}: ${typeName(c.name)};`);
  }
}
w('}');
w('');

w('/** The game API: global functions, and the static functions of each class by its script name. */');
w('export interface GameApi {');
const globalNames = new Set(globals.map((f) => f.name));
for (const f of globals) {
  w(doc(f));
  w(`  ${key(f.name)}${signature(f)};`);
}
for (const [ns, iface] of namespaces) {
  if (!globalNames.has(ns)) w(`  ${key(ns)}: ${iface};`);
}
w('}');

const text = `${lines.join('\n')}\n`;
// Also into dist/, which tsc does not copy declaration files to.
for (const file of [outFile, distFile]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(
  `Game API types: ${data.classes.length} classes (${records.length} TweakDB records), ${data.enums.length} enums, ${globals.length} global functions, ` +
    `${namespaces.length} classes with static functions (${(text.length / 1048576).toFixed(1)} MB) -> ${outFile}`,
);
