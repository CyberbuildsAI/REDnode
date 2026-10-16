# gameCameraSystem

The active camera: the player's view, or a scene's camera.

## GetActiveCameraWorldTransform

Writes the camera's transform into its parameter, which the game does not mark as out. Call it with `api.$out` in place of the parameter to get the value back:

```js
const camera = await api.GameInstance.GetCameraSystem(game.instance);
const r = await camera.GetActiveCameraWorldTransform(api.$out);
const { X, Y, Z } = r.out.transform.position;
```

Measured in game on 2.31 (2026-10-16, [Sound API spike](https://edgemodders.github.io/REDnode/sound.html#s1-spike-results)): the position changes as V walks and stays put while only the camera turns.
