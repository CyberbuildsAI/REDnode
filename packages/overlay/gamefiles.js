// What is installed in the game folder, for packages' "requires" (W2): RED4ext
// plugins with their DLL versions, redscript modules, Cyber Engine Tweaks mods, and
// the frameworks themselves (RED4ext, CET, redscript).
//
//   "requires": { "codeware": ">=1.16", "archivexl": ">=1.23" }
//
// Names match without regard to case, spaces, dashes or underscores, so "ArchiveXL",
// "archive-xl" and "archivexl" are the same. Ranges: ">=1.16", ">1", "<2", "<=1.2",
// "=1.20.3" or "1.20.3", "^1.16" (same major), "~1.16" (same minor), "*" (any),
// several separated by spaces (all must hold) or "||" (any group may hold).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const key = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- versions from Windows files ----------

const versionCache = new Map(); // file -> { mtimeMs, version }

/**
 * A DLL's or EXE's file version ("1.20.3"), from the VS_FIXEDFILEINFO block of its
 * version resource, or null when it has none. The fourth part, a build number, is
 * left out: some plugins put a date there that does not fit and comes out as noise.
 */
function fileVersion(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = versionCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.version;
  let version = null;
  try {
    const buf = fs.readFileSync(file);
    // The block starts with the signature 0xFEEF04BD; the file version follows the
    // structure version, as two 32-bit words: major.minor, then patch.build.
    const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
    for (let at = buf.indexOf(sig); at >= 0 && at + 16 <= buf.length; at = buf.indexOf(sig, at + 4)) {
      if (buf.readUInt32LE(at + 4) >>> 16 !== 1) continue; // dwStrucVersion is 1.0
      const ms = buf.readUInt32LE(at + 8);
      const ls = buf.readUInt32LE(at + 12);
      const parts = [ms >>> 16, ms & 0xffff, ls >>> 16];
      if (parts.every((n) => n === 0)) break;
      version = parts.join('.');
      break;
    }
  } catch {
    version = null;
  }
  versionCache.set(file, { mtimeMs: stat.mtimeMs, version });
  return version;
}

// ---------- the game folder ----------

const listDirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * Everything a package may require, by matching key:
 * { name, kind: 'red4ext' | 'redscript' | 'cet' | 'framework', version, path }.
 */
function scanGame(gameDir) {
  const found = new Map();
  const leftovers = new Set(); // plugin folders without a DLL, for a clearer "not installed"
  found.leftovers = leftovers;
  const add = (name, kind, file, version) => {
    const k = key(name);
    if (!k || found.has(k)) return;
    found.set(k, { name, kind, version: version ?? null, path: file });
  };
  if (!gameDir) return found;

  // The frameworks.
  const frameworks = [
    ['RED4ext', path.join(gameDir, 'red4ext', 'RED4ext.dll')],
    ['Cyber Engine Tweaks', path.join(gameDir, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks.asi')],
    ['redscript', path.join(gameDir, 'engine', 'tools', 'scc.exe')],
  ];
  for (const [name, file] of frameworks) {
    if (fs.existsSync(file)) add(name, 'framework', file, fileVersion(file));
  }
  if (found.has('cyberenginetweaks')) found.set('cet', found.get('cyberenginetweaks'));

  // RED4ext plugins: a folder each, with a DLL, usually of the same name. A folder
  // without a DLL is not a plugin: uninstalls and mod managers leave such folders
  // behind with only logs, configs or Vortex's marker (issue #9).
  const plugins = path.join(gameDir, 'red4ext', 'plugins');
  for (const d of listDirs(plugins)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(plugins, d.name);
    const dlls = listDirs(dir).filter((f) => f.isFile() && /\.dll$/i.test(f.name)).map((f) => f.name);
    const own = dlls.find((f) => key(path.parse(f).name) === key(d.name)) ?? dlls[0];
    if (!own) {
      leftovers.add(key(d.name));
      continue;
    }
    const file = path.join(dir, own);
    add(d.name, 'red4ext', file, fileVersion(file));
    // A plugin whose DLL has another name can be required by either.
    add(path.parse(own).name, 'red4ext', file, found.get(key(d.name))?.version);
  }

  // redscript modules: folders and loose .reds files in r6/scripts.
  const scripts = path.join(gameDir, 'r6', 'scripts');
  for (const d of listDirs(scripts)) {
    if (d.isDirectory()) add(d.name, 'redscript', path.join(scripts, d.name));
    else if (/\.reds$/i.test(d.name)) add(path.parse(d.name).name, 'redscript', path.join(scripts, d.name));
  }

  // Cyber Engine Tweaks mods.
  const cet = path.join(gameDir, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods');
  for (const d of listDirs(cet)) {
    if (d.isDirectory()) add(d.name, 'cet', path.join(cet, d.name));
  }
  return found;
}

// ---------- ranges ----------

function parse(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v).trim());
  if (!m) return null;
  return [m[1], m[2], m[3], m[4]].map((n) => Number(n ?? 0));
}

function compare(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Whether a range is one REDnode understands. */
function validRange(range) {
  if (typeof range !== 'string') return false;
  const text = range.trim();
  if (text === '' || text === '*') return true;
  return text.split('||').every((group) =>
    group
      .trim()
      .split(/\s+/)
      .every((c) => /^(>=|<=|>|<|=|\^|~)?v?\d+(\.\d+){0,3}$/.test(c)),
  );
}

/** Whether a version ("1.20.3") is in a range (">=1.16"). */
function satisfies(version, range) {
  const text = String(range ?? '').trim();
  if (text === '' || text === '*') return true;
  const v = parse(version);
  if (!v) return false;
  return text.split('||').some((group) =>
    group
      .trim()
      .split(/\s+/)
      .every((c) => {
        const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(c);
        const want = parse(m[2]);
        if (!want) return false;
        const d = compare(v, want);
        switch (m[1]) {
          case '>=':
            return d >= 0;
          case '>':
            return d > 0;
          case '<=':
            return d <= 0;
          case '<':
            return d < 0;
          case '^':
            return d >= 0 && v[0] === want[0];
          case '~':
            return d >= 0 && v[0] === want[0] && v[1] === want[1];
          default: {
            // "1.20" means any 1.20.x: only the parts given must match.
            const given = m[2].replace(/^v/, '').split('.').length;
            return v.slice(0, given).every((n, i) => n === want[i]);
          }
        }
      }),
  );
}

/**
 * Checks a manifest's requires against what is installed. One entry per requirement:
 * { name, wants, found: version | null, installed, ok, kind, note }.
 */
function checkRequires(requires, installed) {
  return Object.entries(requires ?? {}).map(([name, wants]) => {
    const hit = installed.get(key(name));
    const anyVersion = String(wants).trim() === '' || String(wants).trim() === '*';
    if (!hit) {
      const note = installed.leftovers?.has(key(name))
        ? 'not installed (its folder in red4ext/plugins has no plugin DLL, left over from an uninstall)'
        : 'not installed';
      return { name, wants, found: null, installed: false, ok: false, kind: null, note };
    }
    if (anyVersion) return { name: hit.name, wants, found: hit.version, installed: true, ok: true, kind: hit.kind, note: '' };
    if (!hit.version) {
      // Installed, but its files carry no version: it counts, and says so.
      return { name: hit.name, wants, found: null, installed: true, ok: true, kind: hit.kind, note: 'installed; its version is unknown' };
    }
    const ok = satisfies(hit.version, wants);
    return { name: hit.name, wants, found: hit.version, installed: true, ok, kind: hit.kind, note: ok ? '' : `version ${hit.version} installed` };
  });
}

module.exports = { scanGame, checkRequires, satisfies, validRange, fileVersion, key };
