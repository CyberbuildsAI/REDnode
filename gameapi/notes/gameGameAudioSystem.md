# gameGameAudioSystem

The game's audio system, `AudioSystem` in scripts. Get it with `GameInstance.GetAudioSystem(gameInstance)`.

## Play

Plays a sound event by name. With no entity and no emitter, it plays a 2D sound, which is how UI sounds are played. Works at the main menu too, because no player is needed.

```swift
// redscript
GameInstance.GetAudioSystem(gameInstance).Play(n"ui_menu_onpress");
```

```js
// REDnode, from a Node mod or an overlay app (the generic game API)
const audio = await api.GameInstance.GetAudioSystem(game.instance);
await audio.Play('ui_menu_onpress');
```

`entityID` and `emitterName` are optional, so the event name alone is enough. The REDnode call was tested in game, first through a hand-written bridge call (2026-10-11), then through the generic game API (2026-10-12); the redscript line follows the signature but has not been compiled in a test yet.

Names confirmed in game on 2.31 (2026-10-11): `ui_menu_onpress`, `ui_menu_hover`, `ui_menu_tutorial_close`, `ui_loot_take_all`, `ui_menu_item_bought`, `ui_jingle_quest_success`. An unknown name plays nothing and raises no error. See [Overlay apps](https://edgemodders.github.io/REDnode/overlay-apps.html#playing-game-sounds).
