# PlayerStateMachineDef

The player's state machine blackboard definition, `GetAllBlackboardDefs().PlayerStateMachine`. It is a local blackboard: get it per player with `BlackboardSystem.GetLocalInstanced(player.GetEntityID(), def)`.

## SceneTier

How much a scene restricts the player, as an `Int32` with the values of the `gamePSMHighLevel` enum: `Default` 0, `SceneTier1` 1 to `SceneTier5` 5.

```swift
// redscript
let psm = GetAllBlackboardDefs().PlayerStateMachine;
let board = GameInstance.GetBlackboardSystem(gameInstance).GetLocalInstanced(player.GetEntityID(), psm);
let tier = board.GetInt(psm.SceneTier);
```

Observed in game on 2.31 (2026-10-11):

| Situation | Tier |
|---|---|
| Talking to an NPC, dialogue choices on screen | 2 |
| Cinematic cutscene, camera taken over | Not observed yet |

REDnode's overlay treats tier 4 and higher as a scene for `"hideWith": ["scene"]`. That threshold is unverified until a cutscene is observed. The redscript lines follow the signatures but have not been compiled in a test yet.
