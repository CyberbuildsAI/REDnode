// Packages the overlay host for players and stages it with the plugin.
//
//   npm run overlay:package
//
// Output, next to the plugin that tools/build-native.ps1 staged, so that
// tools/deploy-native.ps1 copies everything into the game:
//   native/build/dist/red4ext/plugins/REDnode/host/REDnode-overlay.exe  the host, with its own Electron
//   native/build/dist/red4ext/plugins/REDnode/host/resources/sdk/        the rednode package, for apps and mods
//   native/build/dist/red4ext/plugins/REDnode/host/resources/runtime/    the Node mod runtime
//   native/build/dist/red4ext/plugins/REDnode/apps/<id>/                 the example apps and mods
//
// The REDnode plugin starts host/REDnode-overlay.exe when the game loads.

import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
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

// 1. Build the rednode package, which apps and Node mods import.
console.log('Building the rednode package...');
const build = spawnSync('npm run build --workspace rednode', { cwd: repo, stdio: 'inherit', shell: true });
if (build.status !== 0) throw new Error('Building the rednode package failed');

// 2. Stage the app: host code, the built-in launcher, Mod log and Mod Manager, the builder page and the UI kit.
// Apps and mods go to the game separately.
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['main.js', 'preload.js', 'mods.js', 'mcp.js', 'gameapi-lookup.js', 'gamefiles.js', 'redbridge.js']) cpSync(join(overlay, f), join(stage, f));
for (const d of ['launcher', 'modlog', 'manager', 'builder']) cpSync(join(overlay, d), join(stage, d), { recursive: true });
cpSync(join(repo, 'packages', 'ui', 'src'), join(stage, 'ui'), { recursive: true });

// The SDK and the mod runtime go outside app.asar, into resources/, so mod
// processes and their worker threads load them as plain files.
const resources = join(work, 'resources');
const sdk = join(resources, 'sdk');
mkdirSync(sdk, { recursive: true });
const dist = join(repo, 'packages', 'rednode', 'dist');
for (const f of readdirSync(dist)) if (f.endsWith('.js')) cpSync(join(dist, f), join(sdk, f));
writeFileSync(join(sdk, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
cpSync(join(overlay, 'runtime'), join(resources, 'runtime'), { recursive: true });
// Game API types and REDnode's notes, for the MCP server's gameapi_lookup.
const gameapi = join(resources, 'gameapi');
mkdirSync(gameapi, { recursive: true });
cpSync(join(repo, 'packages', 'rednode', 'src', 'generated', 'game.d.ts'), join(gameapi, 'game.d.ts'));
cpSync(join(repo, 'gameapi', 'notes'), join(gameapi, 'notes'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      main: 'main.js',
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ),
);
// The host's runtime dependencies (the MCP SDK), without dev tools.
console.log("Installing the host's dependencies...");
const deps = spawnSync('npm install --omit=dev --no-audit --no-fund --prefer-offline', { cwd: stage, stdio: 'inherit', shell: true });
if (deps.status !== 0) throw new Error("Installing the host's dependencies failed");

// 3. Package with Electron.
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
  extraResource: [sdk, join(resources, 'runtime'), gameapi],
  overwrite: true,
  quiet: true,
  win32metadata: {
    CompanyName: 'Edgemodders',
    ProductName: 'REDnode overlay',
    FileDescription: 'REDnode overlay host',
    OriginalFilename: 'REDnode-overlay.exe',
  },
});

// 4. Keep only the English Chromium locale; the host's UI text comes from the apps.
const locales = join(out, 'locales');
for (const f of readdirSync(locales)) if (f !== 'en-US.pak') rmSync(join(locales, f));

// 5. Stage next to the plugin: host/ and apps/.
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
