// Packages the overlay host for players and stages it with the plugin.
//
//   npm run overlay:package
//
// Output, next to the plugin that tools/build-native.ps1 staged, so that
// tools/deploy-native.ps1 copies everything into the game:
//   native/build/dist/red4ext/plugins/REDnode/host/REDnode-overlay.exe  the host, with its own Electron
//   native/build/dist/red4ext/plugins/REDnode/apps/<id>/                 the example apps
//
// The REDnode plugin starts host/REDnode-overlay.exe when the game loads.

import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const overlay = join(repo, 'packages', 'overlay');
const work = join(repo, 'native', 'build', 'overlay-host');
const stage = join(work, 'app');
const plugin = join(repo, 'native', 'build', 'dist', 'red4ext', 'plugins', 'REDnode');

const pkg = JSON.parse(readFileSync(join(overlay, 'package.json'), 'utf8'));
const electronVersion = pkg.devDependencies.electron;

// 1. Stage the app: host code, the built-in launcher and the UI kit. Apps go to the game separately.
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['main.js', 'preload.js']) cpSync(join(overlay, f), join(stage, f));
cpSync(join(overlay, 'launcher'), join(stage, 'launcher'), { recursive: true });
cpSync(join(repo, 'packages', 'ui', 'src'), join(stage, 'ui'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, license: pkg.license, main: 'main.js' }, null, 2),
);

// 2. Package with Electron.
console.log(`Packaging the host with Electron ${electronVersion}...`);
const [out] = await packager({
  dir: stage,
  out: join(work, 'out'),
  name: 'REDnode-overlay',
  executableName: 'REDnode-overlay',
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  appVersion: pkg.version,
  asar: true,
  overwrite: true,
  quiet: true,
  win32metadata: {
    CompanyName: 'CyberbuildsAI',
    ProductName: 'REDnode overlay',
    FileDescription: 'REDnode overlay host',
    OriginalFilename: 'REDnode-overlay.exe',
  },
});

// 3. Keep only the English Chromium locale; the host's UI text comes from the apps.
const locales = join(out, 'locales');
for (const f of readdirSync(locales)) if (f !== 'en-US.pak') rmSync(join(locales, f));

// 4. Stage next to the plugin: host/ and apps/.
const hostDir = join(plugin, 'host');
const appsDir = join(plugin, 'apps');
rmSync(hostDir, { recursive: true, force: true });
rmSync(appsDir, { recursive: true, force: true });
mkdirSync(plugin, { recursive: true });
cpSync(out, hostDir, { recursive: true });
for (const app of readdirSync(join(overlay, 'apps'))) {
  const dir = join(overlay, 'apps', app);
  if (statSync(dir).isDirectory() && existsSync(join(dir, 'rednode-app.json'))) {
    cpSync(dir, join(appsDir, app), { recursive: true });
  }
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0,
  );
console.log(`Host: ${hostDir} (${(size(hostDir) / 1048576).toFixed(0)} MB)`);
console.log(`Apps: ${readdirSync(appsDir).join(', ')} in ${appsDir}`);
