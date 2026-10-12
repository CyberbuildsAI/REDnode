# RED<span class="y">node</span> docs

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). These pages track the design, the research and how to set up a machine to work on it.

| Document | What it covers |
|---|---|
| [API reference](api/) | The `rednode` package: every function, interface and type, generated from the source |
| [Game API](game/) | Every class, struct, enum and global function in the base game (2.31), with REDnode's notes |
| [Design](design.html) | Architecture: the two tiers, the native bridge, the API sketch, safety rails, risks and roadmap |
| [MCP server](mcp.md) | The kernel's tools for AI agents: Claude Code can read mod logs, see overlay windows, look up game types and call the game |
| [Overlay apps](overlay-apps.md) | Guide with tested examples: your first app, UI kit windows, a native-looking button, and playing game sounds |
| [HTML overlay](overlay.md) | Design of the overlay: how it works, in-game test results, and the plan for phases O1 to O7 |
| [P0 findings](p0-findings.md) | How RED4ext loads plugins, the plugin entry points, and what that means for the bridge |
| [P1 results](p1-results.md) | The in-game probe test: what passed, the logs, and when `OnGameAttached` fires |
| [Dev setup](dev-setup.md) | Every tool and step needed to build and test REDnode on a new machine |

## Roadmap status

| Phase | Status |
|---|---|
| P0 Research | RED4ext side done. Cyber Engine Tweaks analysis deferred |
| P1 Proof | Done. Passed in game on 2026-10-11. See [P1 results](p1-results.md) |
| HTML overlay | O1 to O6 passed in game: Node mods run beside overlay apps, and `api` calls any game function, typed. Next after REDagent: O7 Display. See [HTML overlay](overlay.md) |
| REDagent | An in-game assistant, powered by Claude, that writes, runs and fixes REDnode mods with the player. Phase C1, the [kernel MCP server](mcp.md) in this repo, is built; its in-game test is pending. Its own repo and design: [Edgemodders/REDagent](https://github.com/Edgemodders/REDagent) |
| P2 Tier 2 | Mostly covered by overlay phase O6: the pipe bridge, the Node SDK and the generated game API. Events from hooked game functions are still to do |
| P3 Rules | Not started |
| P4 Tier 1 | Not started |

Source code and issues: [github.com/Edgemodders/REDnode](https://github.com/Edgemodders/REDnode)
