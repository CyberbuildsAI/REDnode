# REDnode on Nexus Mods

The source of REDnode's Nexus Mods page lives here, so updates are edits in the repo, not in Nexus's text box.

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `README.md` | This page: the other fields of the Nexus form, the download file, and how to update |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | REDnode |
| Version | REDnode's version, from `VERSION` (for example 0.24.2) |
| Category | Modders Resources and Tutorials, or Utilities (check the list for Cyberpunk 2077 when creating the page) |
| Brief overview | Mod Cyberpunk 2077 in JavaScript: Node.js mods beside the game, web pages drawn over it as windows and HUD widgets, the whole game API typed, and REDagent, an AI assistant that writes mods with you in the game. (255 characters at most; this is 210) |
| Author | Edgemodders |
| Language | English |
| Primary image | `docs/assets/brand/social.png` (1280 x 640). The banner (`docs/assets/brand/banner.png`) is already at the top of the description |
| Requirements | RED4ext and redscript (Nexus pages). Optional, noted as such: Codeware, TweakXL, ArchiveXL |
| Permissions | MIT: open source, free to modify and redistribute with the license notice. Bundled third-party parts keep their own licenses (`THIRD-PARTY-NOTICES.txt` in the zip) |
| Tags | Framework, modders resource, utility, user interface |

The description has screenshot placeholders in cyan italics (`[Screenshot N: ...]`). Upload each picture to the page's Images tab, then replace its placeholder line with `[img]<the image's Nexus URL>[/img]` and a one-line caption.

## The download

One main file: `REDnode-<version>.zip`, laid out like the game folder, so Vortex, REDdeck and an extract by hand all put it in the same place:

```
red4ext/plugins/REDnode/
  REDnode.dll                the plugin
  Scripts/                   its redscript parts
  host/                      the overlay host, with its own Electron
  apps/<id>/                 the samples, all off until the player switches them on
  LICENSE.txt, THIRD-PARTY-NOTICES.txt, README.txt
```

| What | Where it comes from |
|---|---|
| The samples | `SAMPLES` in `tools/release/nexus-zip.mjs`: Hello mod, Ask mod, UI kit, Vitals, Coords, Perf. The other apps in `packages/overlay/apps` are tests and stay out. The zip's copies have `"open": false` |
| REDbridge | Not in the zip. REDnode runs without it; packages that use `kernel.bridge()` find the copy REDdeck or REDcode fetched. REDbridge is GPL-3.0 and 60 MB, and already reaches players through those two |
| REDagent | Not in the zip. It is its own download (its repo), installed into the same `apps` folder |

### Building it

On GitHub: the **Release zip** workflow (`.github/workflows/release.yml`).

| Trigger | Result |
|---|---|
| Actions tab, **Run workflow** | Builds the zip on a Windows runner and keeps it as the run's artifact, `REDnode-zip` |
| **Run workflow** with **Make a release** ticked, or `npm run release` (the gh CLI starts the same run on `main`) | The same, then tags the commit `v<VERSION>` and makes a GitHub release with the zip. It stops before building if that version is already released |

On this machine, after the usual build:

```powershell
.\tools\build-native.ps1
npm run overlay:package
npm run release:zip      # native\build\release\REDnode-<version>.zip
```

### File description on Nexus

> REDnode &lt;version&gt;: the plugin, the overlay host and six samples. Install with Vortex or REDdeck, or extract into the game folder. Needs RED4ext and redscript.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs nexus/description.bbcode`.
3. Paste the whole file into the description field on Nexus and save.
4. For a new version: run the workflow with **Make a release** ticked, download the zip from the release, and upload it on Nexus as the main file with the version from `VERSION`. Archive the old file.

Keep these in step with the repo's status (README, docs/index.md):

| Where in the description | Update when |
|---|---|
| The STATUS box near the top | The API is declared stable, or the tested game version changes |
| "Highlights" | A phase adds something a player or modder would notice |
| "What is in the download" | `SAMPLES` changes |
| "Requirements" | A required mod or its minimum version changes |
| The roadmap list | Each phase; the next one is marked in cyan (`[color=#19f3ff]Next:[/color]`) |

## BBCode used

Nexus's BBCode has no tables or Markdown, so the page uses only: `[b]`, `[i]`, `[size=2..5]`, `[color=#hex]`, `[center]`, `[quote]`, `[code]`, `[line]`, `[list]` with `[*]`, `[url=...]` and `[img]`. The banner is linked from this repo's `main` branch on GitHub, so it must stay at its path. The colours are the house palette: yellow `#fcee0a` for headings, cyan `#19f3ff` for highlights.
