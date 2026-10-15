# Sound API

Status: **planned**, agreed with the user on 2026-10-14: REDnode builds its own audio engine first, for tighter integration with the EDGE platform and other plugins. [Audioware](https://github.com/cyb3rpsych0s1s/audioware) stays the fallback, as a dependency through `requires`, only if building our own proves prohibitive. Order: after the [TweakDB API](tweakdb.md) and overlay phase O11 Spaces.

## Clean-room rule

Audioware's repository has no license file and declares none (checked on 2026-10-14, release 1.9.9), which by default reserves every right. So:

- REDnode never reads, copies or ports Audioware's source code.
- The feature spec below comes only from [Audioware's public documentation](https://cyb3rpsych0s1s.github.io/audioware/) and its behavior in game, written in our own words. Each spec item says where it came from.
- REDnode's engine is built from that spec and from public libraries with clear licenses.

## What works today

| | Status |
|---|---|
| `game.audio.play(name)` | Plays one of the game's own sound events as a 2D UI sound. Tested in game; six names are confirmed (see `gameapi/notes/gameGameAudioSystem.md`) |
| UI kit sounds | `<rn-button sound="...">` and the kit's press and hover sounds, through the plugin's `audio.play` |
| The rest of the game's `AudioSystem` | 49 functions reachable through `api`: `Play` and `Stop` on an entity or emitter, `PlayOnEmitter`, `Parameter`, `GlobalParameter`, `Switch`, `State`, radio and playlists. **Untested** beyond `Play` |
| Your own audio files | None. The game's engine (Wwise) plays only events from its own soundbanks |
| Audio from an overlay page | **Unverified** whether Chromium plays it in the host. If it does, it ignores the game's volume and pause |
| Tier 1 (in the game, synchronous) | None: Tier 1 is designed but not built |

## Feature spec

From Audioware's documentation (D) and what a modder needs (N). "Match" is to have in REDnode's first full version; "later" can follow.

| Feature | Source | Plan |
|---|---|---|
| Play an audio file from a package by an id, without REDmod. WAV, OGG, MP3 and FLAC | D | Match |
| A manifest of sounds per package (id to file, with settings) | D: a YAML file per mod folder | Match, in `rednode-app.json` or a `sounds` file beside it |
| Categories that follow the game's volume sliders: effects (SfxVolume), dialogue (DialogueVolume), music (MusicVolume), all scaled by MasterVolume | D: four tracks, sfx, onos, voices, music | Match |
| How audio is held: loaded once, loaded each time, or streamed | D: in-memory, on-demand, streaming | Match |
| Per-sound settings: volume, start delay, start offset, a region of the file, loop, playback rate (multiplier or semitones), stereo panning, fade in and fade out with an easing curve | D | Match |
| Settings given in code at play time, not only in the manifest | D: dynamic settings | Match: the options of `audio.play` |
| Sound on an entity (NPC, device, vehicle), louder when near, panned by direction, V as the listener | D: spatialization with registered emitters | Match |
| An entity's sounds end when it despawns; fade when it is defeated | D | Match, with the World API's entity events (W1) |
| Reverb from the game's reverb mix and environment presets | D | Later |
| Player EQ presets: on the phone, underwater | D | Later |
| Voice lines with subtitles, per locale and V's gender, with no fallback locale | D: needs Codeware's localization | Later. Decide whether REDnode shows subtitles itself or through the game |
| Hear the game's own sound events as they are queued, and mute or replace them | D: native integration, hooking the game's audio calls | Later, as a Tier 1 feature. Muting core events (switches, parameters) can break game audio (D) |
| Pause with the game's pause and menus; follow slow motion | N (not in the pages read) | Match. **Research** what the game exposes |
| A typed wrapper of the game's own events (`AudioSystem`): play and stop at V, an entity or a position; parameters, switches, states, radio | N | Match: works today through `api`, needs testing and types |
| Preview game sounds outside the game, and convert them for a package | N, EDGE platform | Later, through REDbridge's `audio.toWav` |
| Agents can list and play sounds | N, EDGE platform | Later: an MCP tool |

## Design

| Decision | Proposal | Why |
|---|---|---|
| Where the engine runs | In the REDnode plugin (C++), inside the game | It reads the camera and entity positions on the game thread every frame, so spatial sound stays in sync, and it pauses with the game. Tier 1 can use it later. The overlay host (Chromium's Web Audio) would be less code, but positions would arrive a frame late over the pipe, and sound would stop with the host |
| Audio library | [miniaudio](https://miniaud.io) (public domain or MIT-0, one C file): decoding WAV, MP3 and FLAC (OGG through its stb_vorbis companion), mixing, Windows output (WASAPI), 3D positioning with distance falloff and doppler | A permissive license that fits REDnode's own; no Rust toolchain in the plugin |
| A second engine beside Wwise | Yes, as Audioware does (D) | Feeding new sounds into Wwise means hooking it deeply. A second engine that follows the game's settings sounds like one game to the player |
| API | An `audio` module in the `rednode` package: `audio.play(id or path, { at, volume, loop, fadeIn, ... })` returns a handle with `stop({ fadeOut })` and `set(...)`; `audio.game.play(event, { at })` for the game's own events | One module for both kinds; Node mods and overlay apps alike |
| Coexisting with Audioware | Both engines can run side by side; a package uses one or the other | Players may have Audioware mods installed |

## Phases

| Phase | Builds | Test proves |
|---|---|---|
| **S1 Play** | The engine in the plugin; files from a package's folder; categories following the game's volume sliders; pause with the game; the settings of the spec; the `audio` module | A package plays an OGG that gets quieter with the game's effects slider and stops while the game is paused |
| **S2 Space** | Sound on entities and positions: distance, direction, doppler; cleanup on despawn; the typed wrapper of the game's own events | A sound on a spawned box gets louder as V walks to it and moves left and right as V turns |
| **S3 Effects and voices** | Reverb, EQ presets, voice lines with subtitles | Later |
| **S4 Game events** | Hearing, muting and replacing the game's own sound events, with Tier 1 | Later |

## Research before S1

| Question | How to find out |
|---|---|
| Where the game keeps its volume sliders and how to read them (and hear changes) | The game's settings system in `gameapi`; test in game |
| How to tell the game is paused, in a menu, or in slow motion | The UI state REDnode already tracks for `hideWith`, and the time system |
| The listener's position: the camera or V | The camera system; compare with how the game's own 3D sounds pan |
| Whether miniaudio's WASAPI output coexists with the game's own output on every common setup (exclusive mode, Bluetooth headsets) | A spike in the plugin |
| Whether overlay pages can play audio at all, and whether REDnode should allow it | A test in the overlay host |

## S1 research spike: built

REDnode 0.23.0 answers the first four questions in game. The fifth (audio in overlay pages) waits for S1 itself.

| Piece | What it does |
|---|---|
| `native/src/overlay/audio.cpp` | REDnode's own output on miniaudio 0.11.25 (public domain or MIT-0), started on first use, stopped with the overlay. One bridge method for now, `audio.tone` (`hz`, `ms`, `volume`), which answers the output device and its format. The plugin log gets an `Audio: output started on "<device>"` line |
| `packages/overlay/apps/sound-test` | A Node mod with a window. **Play test tone** and **Low** play a 440 Hz and a 220 Hz tone. **Read settings** lists every setting under the game's `/audio` group with its value and type. Every half second it reads whether the game is paused, the time dilation and the camera position, and logs each change |

The sample reads the settings through `GameInstance.GetSettingsSystem().GetGroup('/audio')`, the pause through `TimeSystem.IsPausedState()`, the dilation through `TimeSystem.GetActiveTimeDilation`, and the camera through `CameraSystem.GetActiveCameraWorldTransform`. Which of these answer usefully in game is what the test finds out.

REDnode 0.23.1 fixes what the first try showed. The settings system's groups and settings are new objects made by each call, and the plugin held them only weakly, so they were gone before the next call ("that game object no longer exists"). Objects a call makes that nothing in the game holds are now kept until the mod lets go of them. The camera's position comes back through `api.$out`, because `GetActiveCameraWorldTransform` writes into a parameter the game does not mark as out. The sample now waits for a loaded save before it calls the game.

### Test

Switch on **Test timer** and **Sound test** in the launcher. Press **Start** on the timer, and **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save. In the Sound test window, press **Read settings** | A list of audio settings with names and numbers (the master, music, effects and dialogue volumes, among others) |
| 2 | Open the game's Settings, Sound. Move the master volume and the effects volume to different values. Back in the game, press **Read settings** again | The two values changed in the list |
| 3 | Press **Play test tone**, then **Low**, with game sound playing around you | Two short beeps, clean, without crackling, and the game's own sound keeps playing. Note if the game's sound dips or stops |
| 4 | Open the pause menu, wait a moment, close it. Then open the map and close it | The window's "time" line says paused, then not paused (the Mod log has each change) |
| 5 | Slow time if you can (a Sandevistan, or the slow motion at a dodge or a scanner). Otherwise skip | The dilation number changes below 1 |
| 6 | Walk a few steps, then turn the camera around | The camera line's numbers change as you walk, and stay put as you only turn |
| 7 | Alt+Tab out of the game and back, then press **Play test tone** | The tone still plays |
| 8 | If you have headphones or a second output, switch Windows' output to it, then press **Play test tone** | Note where the tone plays: the new output or the old one |

Then quit the game, so the logs are complete.
