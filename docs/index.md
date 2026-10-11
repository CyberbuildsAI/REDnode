# REDnode docs

REDnode is a Node.js API for scripting Cyberpunk 2077 (PC, single-player). These pages track the design, the research and how to set up a machine to work on it.

| Document | What it covers |
|---|---|
| [API reference](api/) | The `rednode` package: every function, interface and type, generated from the source |
| [Design](design.html) | Architecture: the two tiers, the native bridge, the API sketch, safety rails, risks and roadmap |
| [P0 findings](p0-findings.md) | How RED4ext loads plugins, the plugin entry points, and what that means for the bridge |
| [P1 results](p1-results.md) | The in-game probe test: what passed, the log, and the follow-up retest |
| [Dev setup](dev-setup.md) | Every tool and step needed to build and test REDnode on a new machine |

## Roadmap status

| Phase | Status |
|---|---|
| P0 Research | RED4ext side done. Cyber Engine Tweaks analysis deferred |
| P1 Proof | Passed in game on 2026-10-11. Retest planned to explain a repeated event. See [P1 results](p1-results.md) |
| P2 Tier 2 | Not started |
| P3 Rules | Not started |
| P4 Tier 1 | Not started |

Source code and issues: [github.com/CyberbuildsAI/REDnode](https://github.com/CyberbuildsAI/REDnode)
