# RED<span class="y">node</span> docs

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). These pages track the design, the research and how to set up a machine to work on it.

## What REDnode is made of

| Part | What it does | In the repo | In the game folder |
|---|---|---|---|
| **Plugin** (`REDnode.dll`) | Runs inside the game, loaded by RED4ext: draws the overlay windows on the game's frame, takes input (F10), runs game calls on the game thread (the generic game API), sends game events, and starts the host | `native/` | `red4ext/plugins/REDnode/REDnode.dll` |
| **Plugin scripts** | Small redscript parts: the game events REDnode sends, and the world support, which compiles only when Codeware is installed | `native/scripts/` | `red4ext/plugins/REDnode/Scripts/` |
| **Overlay host** | An Electron app beside the game: renders overlay apps, runs Node mods in their processes, the kernel MCP server, the agent broker, hot reload, settings | `packages/overlay/` | `red4ext/plugins/REDnode/host/` |
| **Built-in apps** | The launcher, the Mod log and the Mod Manager, inside the host | `packages/overlay/launcher/`, `modlog/`, `manager/` | Inside the host |
| **`rednode` package** | The API mods and apps import: `game`, `api` (typed from the game's own data), `ui`, `world`, `agent`, `pkg`, `secrets`, `kernel`, `channel` | `packages/rednode/` | `host/resources/sdk/` |
| **UI kit** | Web components and themes for overlay apps | `packages/ui/` | Inside the host, served as `rednode://ui/` |
| **Sample packages** | Example apps and mods (Hello mod, Ask mod, World test, Test timer...). Each has its own version | `packages/overlay/apps/` | `red4ext/plugins/REDnode/apps/` |

**Versions.** REDnode has one version, shared by every part above except the samples. It is in `VERSION` at the root of the repo: the plugin's build reads it, and `node tools/version.mjs <version>` copies it into the host, the package, the UI kit and the built-in apps. `tools/build-native.ps1` stops if any part differs. The plugin's log says `REDnode <version> loading`, the host's log `REDnode overlay host <version>`, and the launcher shows it. Releases will ship the parts together as one REDnode bundle.

| Document | What it covers |
|---|---|
| [API reference](api/) | The `rednode` package: every function, interface and type, generated from the source |
| [Game API](game/) | Every class, struct, enum and global function in the base game (2.31), with REDnode's notes |
| [Design](design.html) | Architecture: the two tiers, the native bridge, the API sketch, safety rails, risks and roadmap |
| [MCP server](mcp.md) | The kernel's tools for AI agents: Claude Code can read mod logs, see overlay windows, look up game types and call the game |
| [Overlay apps](overlay-apps.md) | Guide with tested examples: your first app, UI kit windows, a native-looking button, and playing game sounds |
| [World API](world.md) | The plan for building and placing objects in the game from a package: `$new`, `$set`, resource references, entity events, `api.spawn`, `requires` and `kernel.bridge()` |
| [TweakDB API](tweakdb.md) | The plan for reading and changing TweakDB, the game's tuning database, from a package |
| [Sound API](sound.md) | The plan for REDnode's own audio engine: a package's audio files in the game, following its volume and pause, on entities |
| [HTML overlay](overlay.md) | Design of the overlay: how it works, in-game test results, and the plan for phases O1 to O9 |
| [P0 findings](p0-findings.md) | How RED4ext loads plugins, the plugin entry points, and what that means for the bridge |
| [P1 results](p1-results.md) | The in-game probe test: what passed, the logs, and when `OnGameAttached` fires |
| [Dev setup](dev-setup.md) | Every tool and step needed to build and test REDnode on a new machine |

## Roadmap status

| Phase | Status |
|---|---|
| P0 Research | RED4ext side done. Cyber Engine Tweaks analysis deferred |
| P1 Proof | Done. Passed in game on 2026-10-11. See [P1 results](p1-results.md) |
| HTML overlay | O1 to O6 passed in game: Node mods run beside overlay apps, and `api` calls any game function, typed. O8 Mod Manager (a table of every package, Pin to launcher, Pin to HUD) passed in game. O9 Debugger (DevTools for apps and Node mods, in the game; Developer mode) passed in game. Then O7 Display. See [HTML overlay](overlay.md) |
| REDagent | An in-game assistant, powered by Claude, that writes, runs and fixes REDnode mods with the player. C1, the [kernel MCP server](mcp.md) in this repo, and C2, the chat in the game, passed in game. C3, authoring, passed in game. C4, chat history and a picture of the game's screen (`game_image`), passed in game. C5, other mods asking REDagent (`agent.ask`), passed in game. Its [guide](https://edgemodders.github.io/REDagent/), repo and design: [Edgemodders/REDagent](https://github.com/Edgemodders/REDagent) |
| World API | Planned: W1 (build objects, set properties, resource references, entity events through Codeware, `api.spawn`) and W2 (`requires` in manifests, `kernel.bridge()`), asked for by EDGEbuilder. W1 and W2 passed in game. See [World API](world.md) |
| Window layers | O10: a tool layer for REDnode's own windows and packages allowed `front`, and solo mode (`ui.solo`). Passed in game. See [HTML overlay](overlay.md#o10-layers-built) |
| Spaces | O11, proposed: named sets of windows the player switches between, like virtual desktops. See [HTML overlay](overlay.md#o11-spaces-plan) |
| Sound API | Planned: REDnode's own engine in the plugin (S1 play, S2 space, S3 effects and voices, S4 game events), clean room from Audioware's docs. See [Sound API](sound.md) |
| TweakDB API | Planned: T1 read TweakDB from the plugin, T2 write through TweakXL with undo per package, T3 offline through REDbridge. See [TweakDB API](tweakdb.md) |
| P2 Tier 2 | Mostly covered by overlay phase O6: the pipe bridge, the Node SDK and the generated game API. Events from hooked game functions are still to do |
| P3 Rules | Not started |
| P4 Tier 1 | Not started |

Source code and issues: [github.com/Edgemodders/REDnode](https://github.com/Edgemodders/REDnode)
