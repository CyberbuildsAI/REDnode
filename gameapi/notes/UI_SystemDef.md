# UI_SystemDef

The `UI_System` blackboard definition, reached as `GetAllBlackboardDefs().UI_System`.

## IsInMenu

True while a game menu is open: inventory, map, journal, the pause menu and so on. Read it from the blackboard system:

```swift
// redscript
let ui = GetAllBlackboardDefs().UI_System;
let board = GameInstance.GetBlackboardSystem(gameInstance).Get(ui);
let inMenu = board.GetBool(ui.IsInMenu);
```

REDnode's overlay polls it on the game thread to hide windows with `"hideWith": ["menu"]`. Tested in game on 2.31 (2026-10-11): it turns on for the inventory, the map and the pause menu. The redscript lines follow the signatures but have not been compiled in a test yet.
