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
| Python | 3.14.6 | Small analysis scripts in `tools/`. Standard library only | Any Python 3.10 or later, for example from python.org |

`gh` (GitHub CLI) is **not** installed. Optional, but it makes repository settings scriptable: `winget install --id GitHub.cli -e`.

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
git clone https://github.com/CyberbuildsEX/REDnode.git "$env:USERPROFILE\source\repos\REDnode"
cd "$env:USERPROFILE\source\repos\REDnode"

# Repo-local identity, so a different global identity is left alone
git config user.name  "CyberbuildsEX"
git config user.email "340969962+CyberbuildsEX@users.noreply.github.com"

npm install
npm run typecheck
```

Pushing needs Git Credential Manager signed in as `CyberbuildsEX`. If a push fails with `Permission ... denied to <other account>`, the machine has another GitHub account cached. Remove the `github.com` entry in Windows Credential Manager and push again to get a sign-in prompt.

GitHub Pages serves `docs/` from `main`: https://cyberbuildsex.github.io/REDnode/. It is configured in the repository settings, not in code.

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

The site at https://cyberbuildsex.github.io/REDnode/ is built and deployed by `.github/workflows/pages.yml` on every push to `main`. In the repository settings, **Settings > Pages > Source** must be set to **GitHub Actions**.

| Tool | Version | Install |
|---|---|---|
| TypeDoc | 0.28.20 | Dev dependency of `packages/rednode`, installed by `npm install` |
| Jekyll | Whatever `actions/jekyll-build-pages` ships | Runs in CI only |

Generate the API reference locally:

```powershell
npm run docs:api   # writes docs/api (ignored by git), open docs/api/index.html
```

Previewing the Jekyll pages locally needs Ruby and Jekyll, which are not installed on the reference machine. Push to `main` and check the deployed site instead.
