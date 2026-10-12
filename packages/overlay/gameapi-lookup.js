// Looks up game types and functions for the kernel MCP server (mcp.js).
//
// Reads the TypeScript declarations that tools/gameapi/types.mjs generates for
// the rednode package, so answers show exactly the signatures `api` has, and
// REDnode's notes from gameapi/notes. Loaded on first use: the file is about 9 MB.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LINES = 160; // of one type's declaration in an answer
const MAX_MATCHES = 40;

/**
 * @param {string} aTypesFile  game.d.ts
 * @param {string} aNotesDir   gameapi/notes
 */
function createLookup(aTypesFile, aNotesDir) {
  let index = null; // { blocks: Map<name, text>, script: Map<scriptName, nativeName>, names: string[], api: string[] }

  function load() {
    if (index) return index;
    const text = fs.readFileSync(aTypesFile, 'utf8');
    const lines = text.split('\n');
    const blocks = new Map();
    const script = new Map();
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^export (interface|type) (\w+)/.exec(lines[i]);
      if (!m) continue;
      const name = m[2];
      const doc = i > 0 && lines[i - 1].startsWith('/**') ? lines[i - 1] : '';
      const sm = /^\/\*\* \S+ \((\w+) in scripts\)/.exec(doc);
      if (sm) script.set(sm[1], name);
      let end = i;
      if (m[1] === 'interface') while (end < lines.length && lines[end] !== '}') end += 1;
      blocks.set(name, [doc, ...lines.slice(i, end + 1)].filter(Boolean).join('\n'));
    }
    const apiBlock = blocks.get('GameApi') ?? '';
    index = { blocks, script, names: [...blocks.keys()], api: apiBlock.split('\n') };
    return index;
  }

  function note(native) {
    try {
      return fs.readFileSync(path.join(aNotesDir, `${native}.md`), 'utf8').trim();
    } catch {
      return '';
    }
  }

  function trimBlock(block, member) {
    let lines = block.split('\n');
    if (member) {
      const needle = member.toLowerCase();
      // Keep the header, the closing brace, and members (with their doc line) that match.
      const kept = [lines[0], lines[1]];
      for (let i = 2; i < lines.length - 1; i += 1) {
        const name = /^\s+"?([^"(:]+)/.exec(lines[i])?.[1] ?? '';
        if (name.toLowerCase().includes(needle) && !lines[i].trim().startsWith('/**')) {
          if (lines[i - 1].trim().startsWith('/**')) kept.push(lines[i - 1]);
          kept.push(lines[i]);
        }
      }
      kept.push(lines.at(-1));
      lines = kept;
    }
    if (lines.length > MAX_LINES) {
      const more = lines.length - MAX_LINES;
      lines = [...lines.slice(0, MAX_LINES), `  // ... ${more} more lines: ask again with "member" to filter`, '}'];
    }
    return lines.join('\n');
  }

  /**
   * One type in full (by native or script name), or a list of matches.
   * @param {string} query
   * @param {string} [member]  only members whose name contains this
   */
  return function lookup(query, member) {
    const { blocks, script, names, api } = load();
    const q = String(query || '').trim();
    if (!q) return 'Give a type or function name, or part of one.';

    const native = blocks.has(q) ? q : script.get(q);
    if (native) {
      const parts = [trimBlock(blocks.get(native), member)];
      if (blocks.has(`Statics_${native}`)) {
        const sName = [...script].find(([, n]) => n === native)?.[0] ?? native;
        parts.push(`// Static functions: api.${sName}.Name(...)\n${trimBlock(blocks.get(`Statics_${native}`), member)}`);
      }
      const n = note(native);
      if (n) parts.push(`// REDnode's notes on ${native}\n${n}`);
      return parts.join('\n\n');
    }

    const needle = q.toLowerCase();
    const typeHits = names.filter((n) => !n.startsWith('Statics_') && n.toLowerCase().includes(needle));
    const scriptHits = [...script.keys()].filter((s) => s.toLowerCase().includes(needle) && !typeHits.includes(script.get(s)));
    const fnHits = api.filter((l) => /^\s{2}\S/.test(l) && !l.trim().startsWith('/**') && l.toLowerCase().includes(needle));
    const staticHits = [];
    for (const [name, block] of blocks) {
      if (!name.startsWith('Statics_') || staticHits.length >= MAX_MATCHES) continue;
      const cls = name.slice(8);
      const sName = [...script].find(([, n]) => n === cls)?.[0] ?? cls;
      for (const l of block.split('\n')) {
        if (/^\s{2}\w/.test(l) && l.toLowerCase().includes(needle)) staticHits.push(`api.${sName}.${l.trim()}`);
      }
    }
    const out = [];
    if (typeHits.length || scriptHits.length) {
      const list = [...typeHits, ...scriptHits.map((s) => `${s} (script name of ${script.get(s)})`)];
      out.push(`Types (${list.length}):\n${list.slice(0, MAX_MATCHES).join('\n')}${list.length > MAX_MATCHES ? '\n...' : ''}`);
    }
    if (fnHits.length) {
      out.push(`Global functions, api.Name(...) (${fnHits.length}):\n${fnHits.slice(0, MAX_MATCHES).map((l) => l.trim()).join('\n')}`);
    }
    if (staticHits.length) out.push(`Static functions (first ${staticHits.length}):\n${staticHits.slice(0, MAX_MATCHES).join('\n')}`);
    return out.length ? out.join('\n\n') : `Nothing matches "${q}".`;
  };
}

module.exports = { createLookup };
