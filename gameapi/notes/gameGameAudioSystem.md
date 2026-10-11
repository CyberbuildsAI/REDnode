# gameGameAudioSystem

The game's audio system, `AudioSystem` in scripts. Get it with `GameInstance.GetAudioSystem(gameInstance)`.

## Play

Plays a sound event by name. With no entity and no emitter, it plays a 2D sound, which is how UI sounds are played. Works at the main menu too, because no player is needed.

```swift
// redscript
GameInstance.GetAudioSystem(gameInstance).Play(n"ui_menu_onpress");
```

```js
// REDnode overlay app
await window.rednode.call('audio.play', { name: 'ui_menu_onpress' });
```

`entityID` and `emitterName` are optional, so the event name alone is enough. The REDnode call was tested in game; the redscript line follows the signature but has not been compiled in a test yet.

Names confirmed in game on 2.31 (2026-10-11): `ui_menu_onpress`, `ui_menu_hover`, `ui_menu_tutorial_close`, `ui_loot_take_all`, `ui_menu_item_bought`, `ui_jingle_quest_success`. An unknown name plays nothing and raises no error. See [Overlay apps](https://cyberbuildsai.github.io/REDnode/overlay-apps.html#playing-game-sounds).
