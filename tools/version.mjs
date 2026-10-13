// REDnode's one version, shared by every part: the plugin, the overlay host, the
// rednode package, the UI kit and the host's built-in apps. VERSION at the repo
// root holds it; the plugin's build reads it there, and this script copies it into
// the rest.
//
//   node tools/version.mjs            show the version and where each part stands
//   node tools/version.mjs 0.16.0     set it everywhere
//   node tools/version.mjs --check    fail if any part differs (tools/build-native.ps1 runs it)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = (p) => join(root, p);

// Each part: where its version lives, how to read it and how to write it.
const json = (path) => ({
  path,
  read: () => JSON.parse(readFileSync(file(path), 'utf8')).version,
  write: (v) => {
    const text = readFileSync(file(path), 'utf8');
    writeFileSync(file(path), text.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`));
  },
});
const pattern = (path, re) => ({
  path,
  read: () => readFileSync(file(path), 'utf8').match(re)?.[2],
  write: (v) => {
    const text = readFileSync(file(path), 'utf8');
    writeFileSync(file(path), text.replace(re, (_m, a, _old, b) => `${a}${v}${b}`));
  },
});

const PARTS = [
  { name: 'REDnode (VERSION)', ...pattern('VERSION', /^()([^\r\n]*)()/) },
  { name: 'Overlay host', ...json('packages/overlay/package.json') },
  { name: 'rednode package', ...json('packages/rednode/package.json') },
  { name: 'UI kit', ...json('packages/ui/package.json') },
  { name: 'Launcher', ...json('packages/overlay/launcher/rednode-app.json') },
  { name: 'Mod log', ...json('packages/overlay/modlog/rednode-app.json') },
  { name: 'Mod Manager', ...json('packages/overlay/manager/rednode-app.json') },
  { name: 'Plugin README', ...pattern('native/README.md', /(\(version: )([0-9][^,]*)(,)/) },
];

const arg = process.argv[2];
if (arg && arg !== '--check') {
  if (!/^\d+\.\d+\.\d+$/.test(arg)) {
    console.error(`A version is three numbers, such as 0.16.0, not "${arg}"`);
    process.exit(1);
  }
  for (const p of PARTS) p.write(arg);
  console.log(`REDnode is now ${arg}. The plugin takes it from VERSION at its next build.`);
}

const want = PARTS[0].read();
let differ = 0;
for (const p of PARTS) {
  const have = p.read();
  const ok = have === want;
  if (!ok) differ += 1;
  if (arg !== '--check' || !ok) console.log(`${ok ? '    ' : 'DIFF'}  ${p.name.padEnd(20)} ${have ?? '(not found)'}  ${p.path}`);
}
if (arg === '--check') {
  if (differ) {
    console.error(`${differ} part(s) differ from VERSION (${want}). Run: node tools/version.mjs ${want}`);
    process.exit(1);
  }
  console.log(`REDnode ${want}: every part matches.`);
}
