# userSettingsUserSettings

The game's settings, the values of its Settings menu. `GameInstance.GetSettingsSystem()` returns it. Settings are in groups by path, such as `/audio/volume`; each setting is a `userSettingsVar` of a type such as Int, Bool or ListString, with `GetName()` and `GetValue()`.

Each call to `GetGroup`, `GetGroups` or `GetVars` makes new objects. REDnode keeps them alive while a mod holds them (REDnode 0.23.1 and later).

Measured in game on 2.31 (2026-10-16, [Sound API spike](https://edgemodders.github.io/REDnode/sound.html#s1-spike-results)): `/audio` has the groups `volume` (`MasterVolume`, `SfxVolume`, `DialogueVolume`, `MusicVolume`, `CarRadioVolume`, `RadioportVolume`, Ints from 0 to 100), `dynamicrange` (`SpeakerSetup`, `EnableControllerSpeaker`) and `misc` (`MuteDetectionUISounds`, `StreamerMode`, `MuteInBackground`). A read after the player changes a slider shows the new value.

```js
const settings = await api.GameInstance.GetSettingsSystem(game.instance);
const volume = await settings.GetGroup('/audio/volume');
const master = await (await volume.GetVar('MasterVolume')).GetValue(); // 0 to 100
```
