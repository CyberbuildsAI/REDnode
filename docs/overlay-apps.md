# Overlay apps

Overlay apps are small web apps drawn on top of the game: HTML, CSS and JavaScript. They talk to the game through the `rednode` package and can play the game's own UI sounds. [Node mods](#node-mods) use the same package from Node, and can open windows without writing HTML. Every app example on this page was tested in game on 2026-10-11 (Cyberpunk 2077 2.31), and the Node mod and game API examples on 2026-10-12.

Status: **developer preview.** See the [overlay design](overlay.md) for how it works and what is planned.

## How an app runs

| Part | What it does for your app |
|---|---|
| Overlay host (Electron, outside the game) | Renders your page off-screen and streams it to the game. Gives your page `window.rednode` |
| REDnode plugin (inside the game) | Draws your window, moves it when dragged, and sends you mouse and keyboard input |
| Bridge | Runs your game calls on the game thread and returns the answer as a promise |

In the game, **F10** cycles three modes: passive (your window is drawn, the game gets input), interactive (your window gets input) and hidden. **Esc**, or a click on empty screen, returns input to the game.

The player decides where your package shows, in the built-in **Mod Manager** (opened from the launcher):

| Pin | What it means |
|---|---|
| **Pin to launcher** | Your package is listed in the launcher. Every package is listed in the Mod Manager anyway |
| **Pin to HUD** | Your windows stay on screen during gameplay (passive mode). Unpinned, they show only while the player interacts (F10). HUD widgets are always on the HUD |

A package installed after REDnode 0.14.0 starts with neither pin, and the launcher counts it as new until the player has seen it in the Mod Manager. Tell your players to pin it if it should stay on screen.

## Your first app

An app is a folder with a manifest and a page. Put it in the apps folder: `packages/overlay/apps/` in the repo, or `red4ext/plugins/REDnode/apps/` in the game folder.

`hello/rednode-app.json`:

```json
{
  "id": "hello",
  "name": "Hello Night City",
  "version": "0.1.0",
  "author": "you",
  "description": "Shows where V is.",
  "entry": "index.html",
  "width": 360,
  "height": 200,
  "anchor": "top-left",
  "x": 100,
  "y": 100
}
```

`hello/index.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="rednode://ui/rednode-ui.js"></script>
<style>
  html, body { margin: 0; width: 360px; height: 200px; background: transparent; }
  rn-window { position: absolute; inset: 6px; }
</style>
</head>
<body>
  <rn-window title="Hello Night City" draggable>
    <rn-button id="where">Where am I?</rn-button>
    <p id="out"></p>
  </rn-window>
  <script>
    document.getElementById('where').addEventListener('click', async () => {
      const p = await window.rednode.call('player.position');
      document.getElementById('out').textContent = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`;
    });
  </script>
</body>
</html>
```

Start the game, press F10, open the **REDNODE** launcher tab at the lower left, open the **Mod Manager**, find **Hello Night City** and switch it on (pin it to the launcher to find it there next time). Load a save and click the button. All manifest fields are listed in the [overlay host README](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay#apps-and-manifests).

| Rule | Why |
|---|---|
| Keep the page background **transparent** | Transparent pixels show the game, and clicks on them pass through to whatever is behind |
| Give the page the window's **fixed size** | Pages are drawn 1:1 at 1080p and scaled with the screen height: 2x at 4K |
| **Don't draw a cursor** | The plugin draws it, at the game's frame rate |

## A titled window from markup

The [UI kit](https://github.com/Edgemodders/REDnode/tree/main/packages/ui) turns markup into widgets. This is the test app [`apps/kit`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/kit), cut down:

```html
<rn-window id="win" title="UI kit // O2" draggable>
  <rn-toggle id="theme" slot="status" label="Game theme"></rn-toggle>
  <rn-tabs>
    <rn-tab label="Controls">
      <rn-panel title="Settings">
        <rn-toggle label="Freeze time" checked></rn-toggle>
        <rn-slider id="rain" label="Rain" min="0" max="100" value="35" unit="%"></rn-slider>
        <rn-input id="name" label="Call sign" placeholder="Type here"></rn-input>
        <rn-progress id="progress" label="Upload" value="35"></rn-progress>
      </rn-panel>
    </rn-tab>
    <rn-tab label="Lists">
      <rn-list id="list">
        <rn-item value="arasaka" selected>Arasaka <span slot="end">corp</span></rn-item>
        <rn-item value="militech">Militech <span slot="end">corp</span></rn-item>
      </rn-list>
    </rn-tab>
  </rn-tabs>
</rn-window>
```

The script only wires events:

```js
document.getElementById('theme').addEventListener('change', (e) => {
  document.getElementById('win').setAttribute('theme', e.detail.checked ? 'game' : 'rednode');
});
document.getElementById('rain').addEventListener('input', (e) => {
  document.getElementById('progress').setAttribute('value', e.detail.value);
});
document.getElementById('list').addEventListener('select', (e) => {
  RednodeUI.notify(`Selected ${e.detail.value}`, { title: 'List' });
});
```

| `theme="rednode"` | `theme="hud"` |
|---|---|
| ![The kit window in the REDnode theme](assets/overlay/kit-rednode-theme.png) | ![The kit window in the HUD red theme](assets/overlay/kit-game-theme.png) |

A third theme, `theme="edge"` (EDGE), has solid yellow title bars. The player picks one theme for every window in the launcher; an app that sets its own keeps it. (`hud` and `edge` were called `game` and `yellow` before REDnode 0.16.1; the old names still work.)

The grey checkerboard in these captures is the transparent part of the page. In game, the game shows there.

## A native-looking button

No window frame at all: a borderless page with one game-style button and its menu. The rest of the page is transparent, so it looks like part of the game's UI. From [`apps/native`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/native):

```html
<body theme="hud">
  <rn-menu id="menu" title="Stash" hidden>
    <rn-menu-item value="sell">Sell junk <span slot="end">12</span></rn-menu-item>
    <rn-menu-item value="sort">Sort by value</rn-menu-item>
    <rn-menu-item value="close">Close</rn-menu-item>
  </rn-menu>
  <div class="grip" data-rednode-drag></div>
  <rn-button id="open" sound="ui_menu_onpress">Open stash</rn-button>
</body>
```

```js
const menu = document.getElementById('menu');
document.getElementById('open').addEventListener('click', () => { menu.hidden = !menu.hidden; });
menu.addEventListener('select', (e) => {
  menu.hidden = true;
  if (e.detail.value !== 'close') RednodeUI.notify(`Picked ${e.detail.value}`, { title: 'Stash', theme: 'game' });
});
```

![The native-style button with a game-themed notification](assets/overlay/native-button.png)

Any element with `data-rednode-drag` is a drag handle; here, a small striped grip. `<rn-window draggable>` makes its title area the handle.

## A HUD widget

A HUD widget is drawn over the game but never takes input, like the game's own HUD. Set `"kind": "hud"` in the manifest, and list in `"hideWith"` when the game should hide it. From [`apps/coords`](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/coords):

```json
{
  "id": "coords",
  "name": "Coords HUD",
  "entry": "index.html",
  "kind": "hud",
  "hideWith": ["menu", "photo-mode", "scene", "main-menu"],
  "width": 520,
  "height": 72,
  "anchor": "top",
  "x": 0,
  "y": 14
}
```

| `hideWith` value | Hidden while |
|---|---|
| `menu` | A game menu is open: inventory, map, pause and so on |
| `photo-mode` | Photo mode is on |
| `scene` | A cinematic scene plays (the game's scene tier 4 or higher; unverified) |
| `main-menu` | There is no player: the main menu and loading screens |

The REDnode plugin does the hiding, in the same frame the game changes state. To react in the page as well, listen for `ui-state`:

```js
window.rednode.on((m) => {
  if (m.event === 'ui-state') console.log(m.menu, m.photoMode, m.scene, m.mainMenu, m.sceneTier);
});
```

## Playing game sounds

Sounds play through the game's own audio system, so they mix with the game and follow its volume settings. The bridge call `audio.play` runs the game's native `AudioSystem.Play` with no entity, the way the game plays its 2D UI sounds.

Three ways, from simplest to most control:

```html
<!-- 1. An attribute on a UI kit widget: plays on press -->
<rn-button sound="ui_menu_onpress" hover-sound="ui_menu_hover">Apply</rn-button>
```

```js
// 2. The kit's helper. Never throws; silently skipped outside the game.
RednodeUI.playSound('ui_jingle_quest_success');

// Or set a default for every press in the app:
RednodeUI.sounds.press = 'ui_menu_onpress';

// 3. The bridge call itself. Resolves when the game has played it.
await window.rednode.call('audio.play', { name: 'ui_loot_take_all' });
```

Sound event names confirmed in game on 2026-10-11:

| Name | Use |
|---|---|
| `ui_menu_onpress` | Button press |
| `ui_menu_hover` | Hover |
| `ui_menu_tutorial_close` | Closing a panel |
| `ui_loot_take_all` | Taking items |
| `ui_menu_item_bought` | A purchase |
| `ui_jingle_quest_success` | A success jingle |

The game has many more. An unknown name plays nothing and is not an error, so the kit app's **Sound** tab is the quickest way to try one. The same call from redscript is in the game API reference: [AudioSystem.Play](game/t/gameGameAudioSystem.html#Play).

## Talking to the game

Import the `rednode` package, the same one Node mods use. An import map lets the page import it by name; the host serves it at `rednode://sdk/index.js`. This is the [Coords HUD](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/coords) app:

```html
<script type="importmap">{ "imports": { "rednode": "rednode://sdk/index.js" } }</script>
<script type="module">
  import { game } from 'rednode';

  setInterval(async () => {
    try {
      const p = await game.player.position();   // { x, y, z }; fails at the main menu
      document.getElementById('x').textContent = p.x.toFixed(1);
    } catch {
      // no player yet
    }
  }, 500);
</script>
```

| Call | What it does |
|---|---|
| `game.player.position()` | V's world position. Rejects at the main menu, where there is no player |
| `game.audio.play(name)` | Plays a game sound event |
| `game.on(name, handler)` | A game event. Today `"PlayerPuppet.OnGameAttached"`, at the main menu and on every save load |
| `game.state()`, `game.onState(handler)` | Whether a menu, photo mode, a scene or the main menu is showing, the overlay mode, and whether the game is linked |
| `game.call(method, params)` | Any bridge method by name, for example `"game.info"` |

The full list, with examples, is in the [API reference](api/). For anything else in the game, use the [game API](#the-game-api).

The older `window.rednode` calls still work, and the overlay events `focus` and `overlay` come only through it:

```js
window.rednode.on((m) => {
  if (m.event === 'focus') console.log('focused:', m.focused); // dim your title when false
  if (m.event === 'overlay') console.log('mode:', m.mode);   // passive, interactive or hidden
});
```

## Node mods

A Node mod is Node code that runs in the REDnode host, outside the game: full Node and npm, `await` anywhere, and the game never waits for it. It is a folder with a manifest that has `main` instead of `entry`:

```json
{
  "id": "hello-mod",
  "name": "Hello mod",
  "version": "0.1.0",
  "author": "Edgemodders",
  "description": "A Node mod with a window built by the rednode ui builder.",
  "main": "mod.mjs",
  "open": true
}
```

A mod opens windows with the **ui builder**: a tree of nodes, rendered by the host with the UI kit. No HTML. This is the [Hello mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/hello-mod), shortened:

```js
import { game, ui } from 'rednode';

const where = ui.text('Waiting for the game...');

ui.window({
  title: 'Hello mod',
  anchor: 'right',
  x: -40,
  children: [
    ui.heading('Where is V'),
    where,
    ui.row(
      ui.button('Play sound', () => game.audio.play('ui_menu_onpress')),
      ui.toggle('Follow', (on) => console.log('Follow', on), { checked: true }),
    ),
  ],
});

setInterval(async () => {
  try {
    const p = await game.player.position();
    where.set({ text: `X ${p.x.toFixed(1)}   Y ${p.y.toFixed(1)}   Z ${p.z.toFixed(1)}` });
  } catch (err) {
    where.set({ text: err.message, tone: 'dim' });
  }
}, 500);

game.on('PlayerPuppet.OnGameAttached', () => console.log('A save was loaded'));
```

| Node | Makes |
|---|---|
| `ui.text(text, { tone })`, `ui.heading(text)` | Text. `tone` is `dim`, `accent` or `danger` |
| `ui.button(label, onClick, { variant, sound })` | A button. `variant` is `ghost` or `danger` |
| `ui.toggle(label, onChange, { checked })` | An on and off switch |
| `ui.slider(label, onChange, { min, max, step, value, unit })` | A slider |
| `ui.input({ label, placeholder, value, onChange, onSubmit })` | A text field |
| `ui.progress(value, { label, max })` | A progress bar |
| `ui.row(...nodes)`, `ui.column(...nodes)` | Layout |
| `ui.window({ title, width, height, anchor, x, y, children, onClose })` | Opens the window. The player can drag it in interactive mode, and its position is saved. A saved position applies only while the window keeps the size it was saved with; after a size change it opens at its anchor again |

Every node has `set(props)`, which updates the open window at once.

| Good to know | |
|---|---|
| Output | `console.log` goes to `red4ext/logs/rednode-mods.log`, tagged with the mod id. Open the built-in **Mod log** app from the launcher to watch it live in game; **Copy** puts the lines shown on the clipboard, ready to paste into a bug report. A crash shows only the stack lines in your own code |
| Isolation | Each mod runs on its own thread in a mod process. A thrown error, an endless loop or `process.exit()` stops only your mod. The launcher shows it as **CRASHED** or **NOT RESPONDING** with a **Restart** button |
| Memory | A mod process costs about 80 MB. Players can put mods in one **shared process** with the launcher; three mods then took about 92 MB in total. A native crash in the shared process stops every mod in it, so a mod with native addons should set `"isolation": "process"` |
| Hot reload | With the launcher's **Hot reload** switch on, saving a mod's file restarts the mod, and saving an app's file reloads its page |
| New and removed packages | The host watches the apps folders while it runs. A new package folder starts (if its manifest has `"open": true`), a changed manifest restarts its package, and a removed folder stops it. A package whose manifest names a file that does not exist yet is skipped, and looked at again when any of its files changes |
| `.mjs` | Use the `.mjs` extension for `import` syntax, or add a `package.json` with `"type": "module"` |

## Data, secrets and the kernel

| Call | Gives | Where |
|---|---|---|
| `pkg.id`, `pkg.dir`, `pkg.dataDir` | This package's id, its folder in the apps folder, and a data folder of its own outside it, which survives updates. Write files to `dataDir`, never to `dir`: hot reload watches `dir` | Node mods |
| `secrets.get(name)`, `secrets.set(name, value)`, `secrets.delete(name)` | Secrets such as an API key, encrypted with the player's Windows account and kept by the host. A package reads only its own. A secret that cannot be decrypted, for example one saved under another Windows account, reads as `null` | Node mods and apps |
| `kernel.mcp()` | The address and a token for the [kernel MCP server](mcp.md), for an AI agent in the package. The package must list `"permissions": ["mcp"]` in its manifest, and the player must allow it in the launcher | Node mods and apps |
| `channel.post(data)`, `channel.on(handler)` | Messages between a package's pages and its own Node mod: a web UI with a Node backend | Node mods and apps |
| `kernel.requirements()` | The package's `requires`, checked against the game folder (see [Requirements](#requirements)) | Node mods and apps |
| `tweakdb` | TweakDB's records and flats, read from the running game (see [TweakDB](#tweakdb)) | Node mods and apps |
| `kernel.bridge()` | REDbridge, WolvenKit's engine, for the game's archives and files (see [The game's files through REDbridge](#the-games-files-through-redbridge)). Needs `"permissions": ["bridge"]` and the player's OK | Node mods and apps |

```js
import { pkg, secrets, kernel } from 'rednode';

await secrets.set('api-key', key);
const { url, headers } = await kernel.mcp(); // rejects until the player allows it
```

## Requirements

A package that needs other mods says so in its manifest. REDnode checks the game folder, the Mod Manager marks a package that misses something (**NEEDS** in the table, the list under **Requires** in its details), the launcher says what is missing, and a Node mod's log gets a line when it starts. The package still runs: it can check for itself and explain.

```json
"requires": {
  "codeware": ">=1.16",
  "archivexl": ">=1.23"
}
```

| What a name can be | Version from |
|---|---|
| A RED4ext plugin: its folder in `red4ext/plugins`, or its DLL's name. A folder without a DLL is not a plugin (uninstalls leave such folders behind) | The DLL's file version, when it has one (Codeware, ArchiveXL, TweakXL). Otherwise the version the plugin reported to RED4ext the last time the game loaded it, from RED4ext's newest log, if the DLL has not changed since. Else "version unknown", which still counts as installed |
| A redscript module: a folder or `.reds` file in `r6/scripts` | None: installed or not |
| A Cyber Engine Tweaks mod: a folder in `bin/x64/plugins/cyber_engine_tweaks/mods` | None |
| `red4ext`, `cet` (or `cyber engine tweaks`), `redscript` | RED4ext's and CET's file versions; redscript has none |

Names match without regard to case, spaces, dashes or underscores. Ranges: `>=1.16`, `>1`, `<2`, `<=1.2`, `1.20` (any 1.20.x), `=1.20.3`, `^1.16` (1.16 or later, before 2), `~1.16` (1.16.x), `*` (any version); several separated by spaces must all hold, and `||` gives alternatives.

```js
import { kernel } from 'rednode';

const missing = (await kernel.requirements()).filter((r) => !r.ok);
// [{ name: 'Codeware', wants: '>=1.16', found: null, installed: false, ok: false, note: 'not installed' }]
```

## The game's files through REDbridge

[REDbridge](https://github.com/Edgemodders/REDbridge) runs WolvenKit's engine and answers JSON-RPC: the game's archives (list, search, extract), CR2W files as JSON and back, textures as PNG, hashes. REDnode does not ship it (it is GPL-3.0, its own program): it uses the copy [REDdeck](https://github.com/Edgemodders/REDdeck) ("Get REDbridge") or REDcode fetched, or one set with the `REDBRIDGE_EXE` environment variable. One REDbridge serves every package: it starts on the first call, loads the game's archive index in about three seconds, and stops after 10 minutes without calls.

Add `"permissions": ["bridge"]` to the manifest; the player allows it in the Mod Manager, which also says where REDbridge was found.

```js
import { kernel } from 'rednode';

const bridge = await kernel.bridge(); // rejects until allowed, or when REDbridge is not installed
const archives = await bridge.call('archive.archives');
const found = await bridge.call('archive.search', { query: 'player_ma_tpp', limit: 5 });
await bridge.call('archive.extract', { path: found.items[0].name, outFile: 'C:/temp/player.ent' });
```

Parameters go by name, as REDbridge's [method list](https://edgemodders.github.io/REDbridge/) gives them. The [Packaging test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/packaging-test) sample lists and searches the archives.

## Spaces and the title bar

Players can sort windows into **spaces**, like virtual desktops: the launcher's **Space** row makes them, the tab switches them, and so does Ctrl+1 to 9 while the overlay is open. Only the current space's windows show; REDnode's own tools show in all. A package needs nothing to take part: its windows join the space the player is in, and the player moves them from the title bar or the Mod Manager.

An `rn-window` title bar shows close and up to three action icons, right to left: move to space (once there is a second space), roll up, pin to HUD, reset position (after the window was moved), and debug in Developer mode. More than three: ⋯ on the far left holds the rest. The overlay-window actions (space, pin, reset) show only on a page's only `rn-window`, since they act on the whole page. To leave one out for a window, add `no-space`, `no-rollup` or `no-debug`.

```html
<rn-window title="Speedometer" draggable no-rollup>...</rn-window>
```

## Staying on top and solo mode

REDnode's own windows (the launcher tab, Mod log, Mod Manager, debuggers) live in a **tool layer**, above every package's windows: a full-screen package cannot cover them. A package can ask to join them with `"permissions": ["front"]`; the player allows it in the Mod Manager. The Test timer does this.

A package that needs the screen to itself, such as an editing viewport, can ask for **solo mode**: every other package's windows and HUD widgets are hidden until it ends. Tool windows stay. Add `"permissions": ["solo"]` to the manifest; the player allows it in the Mod Manager.

```js
import { ui } from 'rednode';

ui.onSolo((on) => console.log(on ? 'solo on' : 'solo off'));
await ui.solo(true);  // rejects until the player allows it
await ui.solo(false);
```

Solo ends when the package turns it off, stops or crashes, another package takes it, or the player presses **End** beside the launcher tab, which shows "SOLO" and the package's name. `ui.onSolo` hears every end, so a package can keep its own button in step. The [Layers test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/layers-test) sample shows both.

## Asking the AI assistant

A package can ask the AI assistant (REDagent) a question and show the answer: a build suggestion, an explanation of an error, a summary of the game state. Add `"permissions": ["agent"]` to the manifest; the player allows it in the launcher or the Mod Manager, and REDagent must be installed and on.

```js
import { agent, ui } from 'rednode';

const out = ui.text('');
let text = '';
const { cost } = await agent.ask('Suggest a build for a netrunner at level 12.', {
  context: { level: 12, attributes: { intelligence: 9 } }, // sent as JSON with the question
  onText: (t) => out.set({ text: (text += t) }),            // the answer as it streams
});
```

| Rule | Why |
|---|---|
| Every answer costs the player | Ask when the player wants it, never on a timer. REDagent gives each package a daily limit ($0.25 unless the player changes it) and the player can pause it; past the limit, `ask` rejects and says so |
| The assistant only reads | It may look at logs, the game state, the game API and the apps folders, but never changes files or the game. Pictures of windows and the screen only if the player switches them on for your package |
| Send what it needs | Put your mod's state in `context`, so the assistant does not spend tool calls finding it |
| `signal` stops a question | Pass an `AbortSignal` to let the player cancel |

The [Ask mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/ask-mod) sample asks whatever the player types and streams the answer into its window. The answering side is `agent.serve`, for a package that says `"provides": ["agent"]` in its manifest; REDagent is one.

## The game API

`api` calls any game function by name: global functions, the static functions of a class, and the methods of game objects. It is typed from the game's own type data, the same data as the [game API reference](game/), so an editor completes every class, method and enum member. It works the same in Node mods and in apps.

This is the [Vitals](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/vitals) app, which shows V's health, level and money. The [Game API mod](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/api-mod) reads the same from Node:

```js
import { api, game } from 'rednode';

const player = await api.GetPlayer(game.instance);                  // GetPlayer(GameInstance)
const statsId = await api.$call('Cast;EntityID;StatsObjectID', await player.GetEntityID());
const pools = await api.GameInstance.GetStatPoolsSystem(game.instance);
const stats = await api.GameInstance.GetStatsSystem(game.instance);
const shop = await api.GameInstance.GetTransactionSystem(game.instance);

const health = await pools.GetStatPoolValue(statsId, 'Health', false);
const level = await stats.GetStatValue(statsId, 'Level');
const eddies = await shop.GetItemQuantity(player, await api.MarketSystem.Money());

await shop.GiveItem(player, await api.MarketSystem.Money(), 100);   // a change: 100 eddies
```

| Call | Means |
|---|---|
| `api.GetPlayer(...)` | A global function, by name |
| `api.GameInstance.GetStatsSystem(...)` | A static function, under its class's script name |
| `player.GetEntityID()` | A method of a game object |
| `api.$call('Cast;EntityID;StatsObjectID', ...)` | A global function by its full name: operators, and overloads that share a name |
| `obj.$get('propertyName')` | A property of a game object |
| `obj.$set('propertyName', value)` | Writes a property, with the same type checks as arguments |
| `api.$new('entMeshComponent', { ... })` | Builds a game object by class name, with properties set first. Nothing in the game holds it yet, so its reference keeps it alive until released (or a save loads). A struct comes back as its value |
| `game.instance` | The `GameInstance` argument that many functions take first |

| Game type | In JavaScript |
|---|---|
| Bool, Int8 to Int32, Uint8 to Uint32, Float, Double | `boolean`, `number` |
| Int64, Uint64 | `string`: JavaScript numbers lose precision above 2^53 |
| CName, String | `string` |
| TweakDBID | `"0x..."`. As an argument, a record path such as `"Items.money"` works too |
| Variant | `{ "$type": "Float", "value": 1.5 }`: a value with its type's name, such as `Int32`, `CName` or `array:CName` |
| Enums | The member's name, such as `"Health"` |
| Structs, such as Vector4 or ItemID | Plain objects. As arguments, missing properties keep their default, and `null` is the default value |
| Game objects | References: call their methods with `await`. `null` when there is none |
| Arrays | Arrays |
| Resource references (`rRef`, `raRef`, `ResRef`) | A depot path such as `"base\\environment\\ld_kit\\marker.mesh"`, or its hash as a string. Read back as the hash: turning a hash into a path needs an asset index, such as REDbridge's |

| Good to know | |
|---|---|
| Every call is a round trip | It runs on the game thread between frames and answers a frame or two later. Keep the number of calls per second modest |
| References | A game object comes back as a reference that points at it weakly. When the game deletes the object, or a save loads, calls on it fail with "that game object no longer exists". Get a fresh one after each `PlayerPuppet.OnGameAttached` |
| Wrong arguments | The arguments are checked against the function's types before the call. A wrong one fails with the argument's name and type, and the game is not touched |
| Out parameters | A function with out parameters returns `{ result, out }` |
| Not supported yet | `script_ref` parameters. Such calls fail with a clear message |
| Risk | The checks catch wrong types, not wrong values. Calling a function the game does not expect to be called at that moment can still crash it, as with any script mod |

## TweakDB

TweakDB is the game's database of tuning data: items, weapons, vehicles, characters, perks. A **record** is one thing (`Items.Preset_Lexington_Default`, a `gamedataWeaponItem_Record`); a **flat** is one value in it (`Items.Preset_Lexington_Default.quality`). `tweakdb` reads them from the running game and needs nothing else installed. Changing them comes later, through TweakXL ([plan](tweakdb.md)).

```js
import { tweakdb } from 'rednode';

await tweakdb.get('Items.Preset_Lexington_Default.friendlyName');   // 'w_handgun_militech_lexington'
await tweakdb.flat('Items.Preset_Lexington_Default.quality');       // { type: 'TweakDBID', value: '0x...' }
tweakdb.learn(['Quality.Common', 'Quality.Rare']);
await tweakdb.get('Items.Preset_Lexington_Default.quality');        // 'Quality.Common', now that the name is known
const gun = await tweakdb.record('Items.Preset_Lexington_Default', 'WeaponItem');
await gun?.FriendlyName();                                          // a typed method of the record
await tweakdb.records('Vehicle');                                   // every vehicle record's id
```

| Call | Gives |
|---|---|
| `tweakdb.get(path)` | A flat's value, or `null` |
| `tweakdb.flat(path)` | The value with its type, such as `Float`, `TweakDBID` or `array:CName` |
| `tweakdb.record(path, type?)` | The record as a game object, or `null`. The type (`WeaponItem`, `gamedataVehicle_Record`) only types its methods |
| `tweakdb.records(type)` | The ids of every record of a type |
| `tweakdb.type(path)` | A record's type, or `null` |
| `tweakdb.id(path)` | The game's id of a path, `"0x..."`, computed without the game |
| `tweakdb.name(id)`, `tweakdb.learn(paths)` | The path of an id when known; tell REDnode more names |

**Names.** TweakDB ids are hashes and the game keeps no names. A path your package passed in is remembered, so it comes back as that path; any other id comes back as `"0x..."`. Both forms work as input everywhere. The record types and their methods are in the [game API reference](game/).

### Changing TweakDB

Changes go through [TweakXL](https://github.com/psiberx/cp2077-tweak-xl), the community's standard for TweakDB edits, so they work beside every other TweakXL mod. List it in your manifest, so a player without it sees what is missing:

```json
"requires": { "tweakxl": ">=1.10" }
```

```js
import { tweakdb } from 'rednode';

await tweakdb.set('Items.Preset_Lexington_Default.friendlyName', "REDnode's Lexington");
await tweakdb.clone('Items.MyMod_Lexington', 'Items.Preset_Lexington_Default');
await Promise.all([
  tweakdb.set('Items.MyMod_Lexington.quality', 'Quality.Legendary'),
  tweakdb.set('Items.MyMod_Lexington.tags', ['Weapon', 'MyMod'], { type: 'array:CName' }),
]);
```

| Call | Does |
|---|---|
| `tweakdb.set(path, value, { type? })` | Changes a flat and applies it to its record. The flat keeps its own type; a new flat needs `type` |
| `tweakdb.clone(path, base)` | A new record copied from another one |
| `tweakdb.create(path, type)` | A new, empty record of a type |
| `tweakdb.update(path)` | Applies changed flats to a record; `set` does it already |

**Undone when your package stops.** REDnode remembers each flat's value from before your package first changed it, and puts it back when the package stops: switched off, restarted, hot reloaded or crashed. So a mod sets its values every time it starts, and switching it off really takes its changes away. Records it cloned or created, and flats it added, stay until the game closes, since TweakDB cannot remove them.

Changes made at once, with `Promise.all`, run in the same game frame. Objects already in the game, such as an item in V's inventory, may keep values they copied when they were made: **unverified** which ones.

## Placing things in the world

`world` in the `rednode` package spawns entities with components attached, moves them, removes them, and passes on their lifecycle events. It uses [Codeware](https://github.com/psiberx/cp2077-codeware) 1.14 or later in the game; without it, these calls reject and say so. See [World API](world.md) for how it works.

```js
import { api, world } from 'rednode';

const mesh = await api.$new('entMeshComponent', {
  name: 'my_box',
  mesh: 'base\\environment\\ld_kit\\marker.mesh',
  meshAppearance: 'default',
});
const { id } = await world.spawn({
  // A bare entity in the base game: no components, no appearances.
  template: 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent',
  position: { x: -1234, y: 987, z: 12 },
  yaw: 90,
  components: [mesh],
});
await world.move(id, { x: -1234, y: 988, z: 12 });
await world.remove(id);
```

| Call | What it does |
|---|---|
| `world.spawn(options)` | Spawns an entity from a template (`template`) or a TweakDB record (`record`), and resolves once it is in the world, with its ID and the entity. `components` are attached while it assembles |
| `world.move(id, position, orientation?, yaw?)` | Places it |
| `world.remove(id)` | Removes it |
| `world.watch(id)` | Lifecycle events for an entity spawned some other way |
| `world.on(name, handler)` | `Entity/Initialize`, `Entity/AfterAttach` (or Codeware's old name `Entity/Attached`) and `Entity/Detach`, with the entity's `entityId` and `entityType` |
| `world.entity(id)` | The entity, or `null` once it is gone |
| `world.available()` | True when Codeware is installed and a game is loaded |

The [World test](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay/apps/world-test) sample spawns a box in front of V, spins it and removes it.

## Debugging

Turn on **Developer mode** in the launcher. Every window built with the UI kit's `rn-window` then shows a debug button next to its close button. It opens Chromium's DevTools for that window's page, drawn in the game as an overlay window: elements, styles, the console, sources and breakpoints. The Mod Manager's details also open it, in the game or on the desktop (**Window debugger**). Add `no-debug` to an `rn-window` that should never show the button.

A Node mod has a **Debug (Node inspector)** switch in the Mod Manager. On, the mod restarts alone in its own process with Node's inspector, and the Mod Manager shows the inspector's address:

| Way to debug | How |
|---|---|
| In the game | **Node debugger: In the game** opens Chromium's DevTools for Node as an overlay window. Its console runs in the mod's own thread. In **Sources**, Ctrl+P finds the mod's files; set breakpoints there |
| On the desktop | **On the desktop** opens the same DevTools in a desktop window. Switch to it with Alt+Tab |
| VS Code or REDcode | **Copy** the address, then attach with a `node` launch configuration of type `attach` and `"websocketAddress"` set to it |

The inspector does not wait for a debugger, so the mod's first lines have already run when you attach: set breakpoints in code that runs later, such as an event handler or a button's callback. A restart gives the mod a new inspector address: the in-game debugger follows it by itself; reattach a desktop debugger or VS Code. While the mod is stopped at a breakpoint it does not answer: after 10 seconds the Mod Manager shows it as not responding, which is expected. The switch is not saved: the mod runs normally after REDnode restarts.

An AI agent can read a window's console through the kernel MCP server's `window_console` tool.

## More

| Where | What |
|---|---|
| [UI kit reference](https://github.com/Edgemodders/REDnode/tree/main/packages/ui) | Every component, attribute and event, themes, keyboard keys |
| [API reference](api/) | The `rednode` package: `game`, `ui` and every type, with examples |
| [Overlay host](https://github.com/Edgemodders/REDnode/tree/main/packages/overlay) | Running the host, the app list, the demo apps and mods |
| [Overlay design](overlay.md) | How the overlay works, test results, and the plan |
