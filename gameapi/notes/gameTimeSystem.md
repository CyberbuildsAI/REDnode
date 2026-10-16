# gameTimeSystem

The game's clock: game time, pause and time dilation (slow motion).

## IsPausedState

Measured in game on 2.31 (2026-10-16, [Sound API spike](https://edgemodders.github.io/REDnode/sound.html#s1-spike-results)): stayed `false` the whole time, also while the pause menu was open. It does not tell that a menu paused the game. Use `GetActiveTimeDilation` or the overlay's `menu` state instead.

## GetActiveTimeDilation

With an empty reason and `ignoreCurves` false, it read 1 in play and 0 while a menu was open (same test). It read -1 once while a save was loading. The scanner's slow motion did not change it, so that slow motion is not the global dilation.

A Sandevistan does change it (2.31, 2026-10-16, [Sound API S1](https://edgemodders.github.io/REDnode/sound.html#s1-play-results)): it read 0.3 for the 2 to 3 seconds the Sandevistan was active, then 1 again, on two activations. V's own dilation ([gameTimeDilatable](gameTimeDilatable.md)) stayed 1.
