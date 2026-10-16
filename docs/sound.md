# Sound API

Status: **S1 Play** passed in game on 2026-10-16 (REDnode 0.24.0), and its pan fix in REDnode 0.24.1 the same day. Open: the volume reads (unverified) and the scanner's slow motion. Agreed with the user on 2026-10-14: REDnode builds its own audio engine first, for tighter integration with the EDGE platform and other plugins. [Audioware](https://github.com/cyb3rpsych0s1s/audioware) stays the fallback, as a dependency through `requires`, only if building our own proves prohibitive. Order: after the [TweakDB API](tweakdb.md) and overlay phase O11 Spaces.

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
| Your own audio files | S1 (REDnode 0.24.0, test pending): `audio.play` in the rednode package plays a package's WAV, OGG, MP3 and FLAC files through REDnode's own engine. See [Your own sounds](overlay-apps.md#your-own-sounds) |
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

### S1 spike: results

Tested in game on 2026-10-16 with REDnode 0.23.1, game 2.31. Steps 1 to 4, 6 and 7 passed. Step 5 found a gap. Step 8 was skipped.

| Step | Result |
|---|---|
| 1 Settings | Passed. `/audio` has three groups: `volume` (`MasterVolume`, `SfxVolume`, `DialogueVolume`, `MusicVolume`, `CarRadioVolume`, `RadioportVolume`, each an Int from 0 to 100), `dynamicrange` (`SpeakerSetup`, a ListString such as `Headphones`; `EnableControllerSpeaker`) and `misc` (`MuteDetectionUISounds`, `StreamerMode`, `MuteInBackground`, Bools) |
| 2 Changes | Passed. After the player set master to 50 and effects to 55 in Settings, the next read showed 50 and 55 |
| 3 Tone | Passed. Both tones played cleanly beside the game's sound, which kept playing. The output was the Windows default device, "Optoma UHD (NVIDIA High Definition Audio)", 48 kHz, 8 channels; miniaudio spread the mono tone over it |
| 4 Pause | Partly. `TimeSystem.IsPausedState()` stayed false the whole time, also in the pause menu. `GetActiveTimeDilation('', false)` read 0 while a menu was open, and the overlay's `menu` state turned true for each menu. In one of the two menus the dilation stayed 1; which one is **unverified** |
| 5 Slow motion | Gap. The scanner slowed the game, but `GetActiveTimeDilation('', false)` stayed 1. The scanner's slow motion is not the global dilation. A Sandevistan was not tried |
| 6 Camera | Passed. `GetActiveCameraWorldTransform(api.$out)` gave the camera's position: it changed while walking and stayed put while only turning |
| 7 Alt+Tab | Passed. The tone played after Alt+Tab and back |
| 8 Output switch | Skipped. Whether REDnode's output follows a change of the Windows default device is **unverified** |

Two more findings. Right after a save loaded, the first settings read timed out (the overlay's state no longer said main menu, but the game did not answer yet); a read 2 minutes later worked. And the 0.23.0 try showed that the settings system makes new objects at each call, which led to 0.23.1's fix.

**What this means for S1:**

| Question | Answer for S1 |
|---|---|
| Volume sliders | Read `/audio/volume` through the settings system. Categories: master times one of effects, dialogue or music (and the two radios). Read again when the player leaves the Settings menu (the overlay sees the menu close), or listen with `ConfigVarListener` (**unverified**) |
| Mute in background | Honor `/audio/misc/MuteInBackground` with the plugin's own focus tracking ("the game left the front") |
| Pause | Not `IsPausedState`. Pause REDnode's sounds while the global dilation is 0, or while a menu is open, as a package setting (`pauseWith`) |
| Slow motion | The Sandevistan is the global dilation: 0.3 while active (found in S1's test). The scanner's slow motion is not; where it shows is open. Pitch that follows slow motion is not in S1 |
| Listener | The active camera's transform, for S2 |
| Output | miniaudio on the default device works beside Wwise, including an 8-channel HDMI device. Following a device change is still to test. Since 0.24.1 REDnode mixes in stereo and plays on the device's front pair (see the S1 results) |

## S1 Play: built

REDnode 0.24.0. How to use it: [Your own sounds](overlay-apps.md#your-own-sounds).

| Piece | What it does |
|---|---|
| `native/src/overlay/audio.cpp` | The engine on miniaudio 0.11.25, with stb_vorbis for OGG. The mix is stereo, played on the device's front left and right speakers (0.24.1). Files open on a loader thread. Three groups (effects, dialogue, music) under the engine's master volume. Each frame on the game thread: sounds pause while a menu or loading screen is up (the overlay's own game state) and the ones that ended are announced as `sound-end` events. Mute in background follows the game window's focus. Bridge methods `sound.play`, `sound.stop`, `sound.set`, `sound.list`, `sound.mix` |
| `packages/overlay/main.js` | Finds a sound's file (a manifest name or a path, which must stay inside the package's folder), merges the manifest's settings with the call's, turns semitones into a rate, and checks that a package only stops and changes its own sounds. Reads the game's sliders and Mute in background through the settings system before the first sound, and again after a menu closes or a save loads (`Sound: the game's volumes are ...` in the overlay log). Stops a package's sounds when it stops. A manifest's `sounds` are checked when the package is found |
| `packages/rednode/src/audio.ts` | `audio.play`, `audio.stopAll`, `audio.playing`, and a `Sound` with `stop`, `set` and `ended` |
| `apps/sound-test` | 0.2.0: buttons for each format and setting, the list of what plays, and the game's and V's time dilation for the Sandevistan check |
| `tools/sounds/make-sample-sounds.py` | Synthesizes the sample's four files, so they are REDnode's own |
| `native/tests/audio_test.cpp` | Decodes the four files with the plugin's set-up: format, length, not silent. Since 0.24.1 also pan on the stereo mix, and the stereo mix reaching only the front pair of a 7.1 device |

Not in S1: easing curves for fades (miniaudio fades are linear), pitch that follows slow motion, sound on entities and positions (S2). The sliders are applied as linear gain; whether that matches how the game's own sound scales is for the test.

### S1 test

Switch on **Test timer** and **Sound test** in the launcher, press **Start**, and press **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save. Press **Music (OGG)** | Music fades in over a second and a half and loops without a gap or click at the loop point (every 8 seconds). The list shows it playing |
| 2 | Press **Beep (WAV)**, **Chime (FLAC)** and **Voice (MP3)**, one after another, with the music on | Each plays once over the music. The voice is a synthetic "ah, oh" |
| 3 | Press **Voice +12 semitones**, **Chime left**, **Chime right**, **Beep in 2 s** | The voice an octave higher and twice as fast; the chime in the left ear, then the right; the beep two seconds after the press |
| 4 | Press **Music quieter**, wait, then **Music louder** | The music fades down over a second, then back up |
| 5 | Open the pause menu for a few seconds, then close it. Do the same with the map | The music stops while the menu is open and goes on from where it was when it closes |
| 6 | In Settings, Sound, lower **Music volume** to about 30, close the menus | The music is quieter. Then lower **Sound effects volume** and press **Chime (FLAC)**: the chime is quieter too. Put both back |
| 7 | In Settings, Sound, lower **Master volume** to about 30, close the menus, press **Beep (WAV)** | Music and beep are quieter. Compare by ear with the game's own sound: do ours and the game's drop by about the same amount? Put it back |
| 8 | Turn on **Mute in background** in Settings, Sound if it is off. Alt+Tab out for a few seconds with the music on, then come back | The music is silent while the game is in the background, and plays again when it is back |
| 9 | Press **Stop all** | Everything fades out over half a second. The list says nothing is playing |
| 10 | Press **Music (OGG)**, then switch the Sound test off in the launcher | The music stops (fades out) when the package stops |
| 11 | If you can: use a Sandevistan with the Sound test on | Note the "global dilation" and "V's dilation" lines while it is active |

Then quit the game, so the logs are complete.

### S1 Play: results

Tested in game on 2026-10-16 with REDnode 0.24.0, game 2.31. The Test timer was not used, so the log lines are not tied to steps. Steps 1 to 10 passed by ear, except the pan in step 3. Step 11 was not done.

| Step | Result |
|---|---|
| 1 Music | Passed. Fade in and a clean loop |
| 2 Formats | Passed. WAV, FLAC and MP3 over the OGG music |
| 3 Settings | Pitch (+12 semitones) and the 2 s delay passed. **Pan failed:** "Chime left" and "Chime right" sounded the same, both a little to the right |
| 4 Fades | Passed |
| 5 Menus | Passed. The music stopped in the pause menu and the map, and went on from where it was |
| 6 Sliders | Passed by ear. A chime pressed while the Settings menu was open waited for the menu to close, as `pauseInMenu` says: the log has three chimes from the menu ending together when it closed |
| 7 Master | Passed by ear: ours and the game's sound dropped together. The linear gain is close enough for now |
| 8 Mute in background | Passed. The overlay log read `muted in the background`; the music was silent while the game was in the background |
| 9 Stop all | Passed |
| 10 Package stops | Passed. The music stopped when the Sound test was switched off |
| 11 Sandevistan | Done afterwards, the same day. The global dilation read 0.30 for 2 to 3 seconds on each of two activations, then 1.00. V's dilation stayed 1.00 and V did not ignore the global dilation. So the global dilation is the signal for the Sandevistan; V's own value does not show that V moves at normal speed |

**Why pan failed.** The device was the 8-channel HDMI output. miniaudio's engine mixed at the device's 8 channels, and its panner works only on a stereo mix: for other channel counts it copies the sound through unchanged. Our mono files were spread over all 8 speakers, whatever the pan.

**The fix, REDnode 0.24.1.** The plugin opens the device itself, mixes in stereo, and maps the mix to the device's front left and right speakers with miniaudio's "simple" channel mode. Its default mode would also fill the centre and surround speakers from a stereo mix. Every speaker layout has the front pair, and a downmix to headphones keeps it. S2's direction is then left and right only, like most games on headphones; surround output can come later as a setting. The unit test now checks pan on the stereo mix and the stereo-to-7.1 conversion. The plugin log line now reads `..., 8 channels, mixed in stereo to the front pair`.

**Open from this run.**

| Question | Status |
|---|---|
| The volume reads | **Unverified.** Each read after a Settings visit showed master and effects equal (45 and 45, later 60 and 60), and music at 100, while step 6 lowers music. Either the player set those, or a read is wrong. The spike's reads (master 50, effects 55) were right |
| Slow motion | The Sandevistan: answered (step 11). The scanner's slow motion: still not found; the global dilation stays 1 |
| A change of the Windows default device | Open |

### S1 check, REDnode 0.24.1

Switch on **Test timer** first, press **Start**, and press **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save, switch on **Sound test**. Press **Chime left**, then **Chime right**, then **Chime (FLAC)** | Left speaker only, right speaker only, then both. The plugin log says `mixed in stereo to the front pair` |
| 2 | In Settings, Sound, set **Music volume** to 30 and leave the others. Close the menus | The overlay log reads `master 100, effects 100, dialogue 100, music 30`. Put it back |
| 3 | Hold the scanner for a few seconds with the Sound test on | Note whether "V's dilation" changes (the global dilation did not in the spike) |

Then quit the game, so the logs are complete.

**Result, 2026-10-16.** Step 1 passed: left only, right only, then both; the plugin log says `8 channels, mixed in stereo to the front pair`. Step 2 left no answer: the overlay log has no new volume read after the Settings visit, and only step 1 was marked, so whether the music slider was changed is not known. The volume reads stay **unverified**. Step 3: the scanner did not slow time in this run, and NPCs walked at normal speed while V seemed slower. The player suspects one of their mods; the scanner's slow motion stays open.
