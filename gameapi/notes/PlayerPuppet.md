# PlayerPuppet

The player character, V. Scripts usually get it with `GetPlayer(gameInstance)`.

## OnGameAttached

Runs when the player puppet is attached to the game world. It does **not** mean a save has loaded, and it runs more than once per session:

| Player action | Runs |
|---|---|
| Game reaches the main menu | Yes, once |
| Load a save, from the main menu or the pause menu | Yes, once per load |
| Open the load-save list | No |
| Save the game | No |

Tested on 2.31 with a `@wrapMethod` probe. See [P1 results](https://cyberbuildsai.github.io/REDnode/p1-results.html).
