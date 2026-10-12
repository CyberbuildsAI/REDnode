# RED<span class="y">node</span> docs

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). These pages track the design, the research and how to set up a machine to work on it.

| Document | What it covers |
|---|---|
| [API reference](api/) | The `rednode` package: every function, interface and type, generated from the source |
| [Game API](game/) | Every class, struct, enum and global function in the base game (2.31), with REDnode's notes |
| [Design](design.html) | Architecture: the two tiers, the native bridge, the API sketch, safety rails, risks and roadmap |
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
| HTML overlay | O1 to O6a passed in game: Node mods run beside overlay apps. Next: O6b Game API. See [HTML overlay](overlay.md) |
| REDclaude | Planned after O6: an in-game Claude assistant that uses the kernel API to help write mods. Its own repo: [Edgemodders/REDclaude](https://github.com/Edgemodders/REDclaude) |
| P2 Tier 2 | Mostly covered by overlay phase O6: the pipe bridge and the Node SDK. Events from hooked game functions are still to do |
| P3 Rules | Not started |
| P4 Tier 1 | Not started |

Source code and issues: [github.com/Edgemodders/REDnode](https://github.com/Edgemodders/REDnode)
