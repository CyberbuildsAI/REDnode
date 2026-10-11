# REDnode: notes for Claude sessions

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). Read [docs/design.html](docs/design.html) for the architecture and [docs/p0-findings.md](docs/p0-findings.md) for how RED4ext plugins work before changing the native code.

## Current status and next step

- **P0 Research:** RED4ext side done. Cyber Engine Tweaks analysis deferred.
- **P1 Proof:** the probe plugin in `native/` builds. **Next step: the in-game test.**
  1. Build: `.\tools\build-native.ps1`
  2. Deploy: `.\tools\deploy-native.ps1` (add `-GameDir '<path>'` if the game is not at the default Steam path). Ask the user first, because it changes their game folder.
  3. The user launches the game from Steam, loads a save, plays about two minutes, and quits to desktop through the menu.
  4. Read `red4ext/logs/red4ext-*.log` (and any REDnode log beside it) plus `r6/logs/` for redscript errors. Success is `Event drained on frame N: PlayerPuppet.OnGameAttached REDnode_Ping(21) = 42`. The full list of expected lines is in [native/README.md](native/README.md).
  5. Write the results into `docs/p0-findings.md` (or a new `docs/p1-results.md`) and update the roadmap table in `docs/index.md`.

The game needs about 12 to 16 GB of RAM. On a 16 GB machine, ask the user to close other apps before testing.

## Setting up a new machine

Follow [docs/dev-setup.md](docs/dev-setup.md) top to bottom. Whenever you install a tool or change setup, update that file in the same change, with exact versions and commands.

## Conventions

- **Commits:** commit straight to `main` and push, in small logical commits. Agree the plan in chat first. Use a PR only for large or risky changes, and ask before opening one.
- **Git identity:** set per repo to `CyberbuildsEX` with the GitHub no-reply email (see dev-setup). Never change the global identity.
- **Never commit game files** or data extracted from them (DLLs, archives, RTTI dumps). `.gitignore` covers the common cases.
- **Writing style:** plain, short sentences. Tables for comparisons and lists of facts. Use the design doc's terms: Tier 1 (sync interceptors, in-process), Tier 2 (async Node mods, out of process), declarative rules, phases P0 to P4, and the `rednode` package name. Mark anything unverified as unverified.

## Docs site

- `docs/` is published by GitHub Pages at https://cyberbuildsex.github.io/REDnode/. It is the human-facing documentation, so it must look polished.
- `.github/workflows/pages.yml` builds and deploys the site on every push to `main`: TypeDoc generates the API reference into `docs/api`, then Jekyll renders `docs/`. Never commit `docs/api`.
- Give every exported symbol in `packages/rednode/src` a TSDoc comment with an `@example` where it helps. That is the source of the API reference.
- Write docs as markdown in `docs/`. Jekyll renders them with the HUD layout (`docs/_layouts/default.html`, `docs/assets/css/hud.css`). Add every new page to `nav` in `docs/_config.yml`.
- `docs/design.html` is a standalone, hand-written page and must stay a complete HTML document.
- Long-term goal: a rich, navigable docs site with a full API browser. Offline browsing (shipping the built site) is a later concern.
