# Development setup

Everything installed or configured to work on REDnode, in the order it was done. A fresh machine should be able to follow this top to bottom.

Reference machine: Windows 11 Home (build 26200), 16 GB RAM.

## 1. Base tools

| Tool | Version used | Why | Install |
|---|---|---|---|
| winget | 1.29.380 | Installs everything else | Ships with Windows 11 (App Installer) |
| Git for Windows | 2.55.0 | Source control. Includes Git Credential Manager 2.8.0 | `winget install --id Git.Git -e` |
| nvm for Windows | (any) | Manages Node versions | `winget install --id CoreyButler.NVMforWindows -e` |
| Node.js | 24.18.0, npm 12.0.1 | The `rednode` SDK package | `nvm install 24` then `nvm use 24` |
| Python | 3.14.6 | Small analysis scripts in `tools/`. Standard library only, except `tools/sounds/make-sample-sounds.py`, which needs numpy 2.4.3 and soundfile 0.13.1 (`pip install numpy==2.4.3 soundfile==0.13.1`; only to change the Sound test's files) | Any Python 3.10 or later, for example from python.org |

`gh` (GitHub CLI) 2.102.0 is optional. It makes repository settings scriptable and shows Pages deploy runs:

```powershell
winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
gh auth login   # interactive: GitHub.com, HTTPS, sign in in the browser as CyberbuildsAI
```

Open a new terminal after installing so `gh` is on PATH.

## 2. C++ toolchain for the native plugin

The RED4ext SDK needs CMake 3.21 or later and C++20.

| Tool | Version | Install |
|---|---|---|
| Visual Studio 2022 Build Tools | 17.14 (MSVC toolset v143) | See command below |
| CMake and Ninja | Bundled with the Build Tools C++ workload | Included |

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --source winget `
  --accept-package-agreements --accept-source-agreements `
  --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

- Windows shows an admin (UAC) prompt. The download is several GB and takes 10 to 20 minutes.
- **Low memory:** on a 16 GB machine the install ran short of memory with Steam and Chrome open. Close them first.
- If the command that started the install is interrupted, the Visual Studio installer keeps running on its own. Wait for the `setup` and `vs_setup_bootstrapper` processes to exit instead of starting a second install.
- VS 2022 rather than 2026: its toolset (14.44) needs a Visual C++ runtime no newer than what players typically have. The reference machine's runtime is 14.51.

Verify:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

Verified on the reference machine: Visual Studio Build Tools 2022 **17.14.37710.0**, MSVC toolset **14.44.35207** (compiler 19.44.35229), CMake bundled with the Build Tools.

### Build and deploy the plugin

```powershell
.\tools\build-native.ps1           # configure, build, stage native\build\dist\red4ext\plugins\REDnode
.\tools\deploy-native.ps1          # copy into the game (close the game first)
.\tools\deploy-native.ps1 -Remove  # take it out again
```

The first configure clones RED4ext.SDK at the pinned commit, so it needs network access. The build needs no developer shell, because the script finds the Build Tools and their bundled CMake with `vswhere`.

## 3. Repository and GitHub

```powershell
git clone https://github.com/Edgemodders/REDnode.git "$env:USERPROFILE\source\repos\REDnode"
cd "$env:USERPROFILE\source\repos\REDnode"

# Repo-local identity, so a different global identity is left alone
git config user.name  "CyberbuildsAI"
git config user.email "340969962+CyberbuildsAI@users.noreply.github.com"

npm install
npm run typecheck
```

Pushing needs Git Credential Manager signed in as `CyberbuildsAI`. If a push fails with `Permission ... denied to <other account>`, the machine has another GitHub account cached. Remove the `github.com` entry in Windows Credential Manager and push again to get a sign-in prompt.

GitHub Pages serves `docs/` from `main`: https://edgemodders.github.io/REDnode/. It is configured in the repository settings, not in code.

## 4. Game install for testing

| Component | Needed by REDnode | Version on reference machine |
|---|---|---|
| Cyberpunk 2077 (Steam) | Yes | 2.31 (file version 3.0.80.51928) |
| RED4ext | Yes. Loads the native plugin | 1.30.0 |
| redscript | Yes. Compiles the plugin's `.reds` files (run by RED4ext as `scc`) | Present |
| Ultimate ASI Loader | No | 6.0.0 |
| Cyber Engine Tweaks | No. Studied as prior art | Present |
| ArchiveXL, Codeware | No | 1.27.1, 1.20.3 |

Default Steam path: `C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077`. Mods on the reference machine are managed by Vortex.

On a new machine, install the two required mods before testing, through a mod manager or by hand from their official releases:

- RED4ext: https://github.com/WopsS/RED4ext/releases (also on Nexus Mods)
- redscript: https://github.com/jac3km4/redscript/releases (also on Nexus Mods)

Match their versions to the installed game version. Check that RED4ext works by launching the game once and looking for `red4ext/logs/red4ext-*.log`.

If the game is not at the default path, pass it to the deploy script: `.\tools\deploy-native.ps1 -GameDir 'D:\Games\Cyberpunk 2077'`.

The game needs about 12 to 16 GB of RAM. On a 16 GB machine, close other apps before testing.

## 5. Reference sources

Read-only clones used for research. They live outside the repo and are never committed.

| Source | Revision | Used for |
|---|---|---|
| [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) (MIT) | master `ad72777` (2026-07-30) | Plugin ABI, RTTI access, examples |

```powershell
git clone --depth 1 https://github.com/WopsS/RED4ext.SDK.git
```

## 6. Docs site

The site at https://edgemodders.github.io/REDnode/ is built and deployed by `.github/workflows/pages.yml` on every push to `main`. In the repository settings, **Settings > Pages > Source** must be set to **GitHub Actions**.

| Tool | Version | Install |
|---|---|---|
| TypeDoc | 0.28.20 | Dev dependency of `packages/rednode`, installed by `npm install` |
| Jekyll | Whatever `actions/jekyll-build-pages` ships | Runs in CI only |

Generate the API reference locally:

```powershell
npm run docs:api   # writes docs/api (ignored by git), open docs/api/index.html
```

Previewing the Jekyll pages locally needs Ruby and Jekyll, which are not installed on the reference machine. Push to `main` and check the deployed site instead.

## 7. Brand images

The README banner, the GitHub social preview and the README badges are generated, then committed.

```powershell
.\tools\brand\render.ps1   # needs Chrome or Edge, Python, and network access for the web fonts
```

| Output | Size | Used by |
|---|---|---|
| `docs/assets/brand/banner.png` | 2560 x 640 | README header |
| `docs/assets/brand/social.png` | 1280 x 640 | Uploaded by hand in **Settings > General > Social preview** |
| `docs/assets/brand/badges/*.svg` | | README badges. Edit the list in `tools/brand/badges.py` |
| `docs/assets/brand/icon.png` | 256 x 256 | App and site icon, from `tools/brand/icon.html` |

Edit `tools/brand/brand.html` to change the banner. Re-run the script after changing version numbers in the badges.

## 8. VS Code theme

The REDnode HUD color theme for VS Code lives in the [REDcode](https://github.com/Edgemodders/REDcode) repository, at `extensions/rednode-hud-theme`, because REDcode is the VS Code environment REDnode mods are built in. Build or install it from there (`npm run theme:package` in REDcode). This repository no longer carries a copy.

## 9. Game API reference

The game API reference at https://edgemodders.github.io/REDnode/game/ is generated from a base-game RTTI dump, committed as `gameapi/<game version>/rtti.json`, plus REDnode's notes in `gameapi/notes/`.

| Tool | Version | Install |
|---|---|---|
| marked | 18.1.0 | Root dev dependency, installed by `npm install`. Renders the notes |

Build it locally:

```powershell
npm run docs:game   # writes docs/game (ignored by git), about a minute, ~100 MB
```

Open `docs/game/index.html` in a browser. Search needs a web server, because browsers block `fetch` on `file://` pages.

### New dump after a game patch

Do this once per game patch. The dump must contain only the base game, so every other mod has to be off.

1. In Vortex, create a profile named `vanilla` with only RED4ext enabled, switch to it and click **Deploy**. Mods installed outside Vortex stay behind. Check `red4ext/plugins/` for other plugin DLLs.
2. If another RED4ext plugin is still in `red4ext/plugins/`, add its folder name to `ignored` in `red4ext/config.ini`, for example `ignored = ["cet_mod_manager"]`. Script mods in `r6/scripts` do not matter, because redscript is not deployed in this profile.
3. Build and deploy REDnode, then create an empty `dump.request` file next to `REDnode.dll`:

   ```powershell
   .\tools\build-native.ps1
   .\tools\deploy-native.ps1 -GameDir '<game folder>'
   New-Item -ItemType File '<game folder>\red4ext\plugins\REDnode\dump.request'
   ```

4. Launch the game, wait for the main menu and quit. The REDnode log shows `RTTI dump written to ...`, and the plugin deletes `dump.request`.
5. Check `red4ext/logs/red4ext-*.log`: REDnode must be the only plugin that says `has been loaded`.
6. Import the dump, giving the game's product version from the RED4ext log:

   ```powershell
   npm run gameapi:import -- '<game folder>\red4ext\plugins\REDnode\rtti-dump.json' --game 2.31
   ```

7. Set `ignored = []` back in `red4ext/config.ini`, and switch Vortex back to your normal profile.

## 10. HTML overlay host

`packages/overlay` is the overlay host from [the overlay design](overlay.md): an Electron app that renders overlay apps off-screen and streams them to the REDnode plugin in the game. `packages/ui` is the UI kit apps use.

| Tool | Version | Install |
|---|---|---|
| Electron | 44.7.0 | Dev dependency of `packages/overlay`, installed by `npm install` |
| @electron/packager | 20.3.0 | Dev dependency of `packages/overlay`. Packages the host for players |

On the reference machine `npm install` did not run Electron's install script, so the Electron binary was missing. Download it by hand once:

```powershell
node node_modules/electron/install.js   # puts electron.exe in node_modules/electron/dist (about 370 MB)
```

Run the host:

```powershell
npm run overlay          # off-screen, waits for the game on \.\pipe\rednode-overlay
npm run overlay:window   # the demo app in a normal window, without the game
```

Package the host the way players get it, then deploy it with the plugin:

```powershell
.\tools\build-native.ps1
npm run overlay:package    # host\REDnode-overlay.exe and apps\ next to the staged plugin (about 320 MB)
.\tools\deploy-native.ps1 -GameDir '<game folder>'
```

With the packaged host deployed, the plugin starts it with the game, so `npm run overlay` is not needed. Only one host runs at a time: one started by hand before the game keeps the pipe, and the packaged one exits. The packaged host logs to `red4ext/logs/rednode-overlay.log`.

The host clears `ELECTRON_RUN_AS_NODE` before starting Electron, because VS Code sets it for processes it starts and it turns Electron into plain Node.

CI skips the Electron download with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, because the docs build does not need it.
