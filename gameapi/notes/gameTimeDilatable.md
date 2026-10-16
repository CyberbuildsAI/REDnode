# gameTimeDilatable

An object with its own time dilation (slow motion), on top of the game's global one. The player puppet, NPCs and devices are time dilatable.

## GetTimeDilationValue

Measured in game on 2.31 (2026-10-16, [Sound API S1](https://edgemodders.github.io/REDnode/sound.html#s1-play-results)) on the player: it read 1 in play and 0 while a menu was open, like the global dilation. During a Sandevistan it stayed 1 while the global dilation fell to 0.3. So it does not show V moving at normal speed inside the slowed world; how the game exempts V is **unverified**.

## IsIgnoringGlobalTimeDilation

On the player it read `false`, also during a Sandevistan (same test).
