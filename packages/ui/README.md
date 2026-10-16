# @rednode/ui

Status: **phase O2 of the [HTML overlay](../../docs/overlay.md).** Web components for REDnode overlay apps. Write UI as markup, not code.

```html
<script src="rednode://ui/rednode-ui.js"></script>

<rn-window title="Weather control" draggable>
  <rn-toggle label="Freeze time"></rn-toggle>
  <rn-slider label="Rain" min="0" max="100" value="35" unit="%"></rn-slider>
  <rn-button sound="ui_menu_onpress">Apply</rn-button>
</rn-window>
```

The overlay host serves the kit to every app at `rednode://ui/rednode-ui.js`. It is one plain script with no build step and no dependencies. Working examples: [apps/kit](../overlay/apps/kit/) (every widget) and [apps/native](../overlay/apps/native/) (a borderless, game-style button).

## Rolling windows up

Double-click an `rn-window`'s title bar to roll it up to the title bar, and again to roll it down. Each window remembers its state. In the game the REDnode plugin reports the double-click, because it handles presses on title bars for dragging. The window emits `rollup` with `{ rolled }`; `toggleRollup()` does the same from code, and the `no-rollup` attribute turns it off for a window.

**Title-bar actions.** An `rn-window` shows close and up to three action icons, right to left, the most used next to close: move to space (once the player has a second space), roll up, pin to HUD, reset position (after the window was moved), and debug in Developer mode (Chromium's DevTools for the page, or the Node debugger for a mod window whose mod runs with the debugger). More than three: a ⋯ button on the far left holds the rest; an action with choices swaps the menu's list for them, with a Back row. The overlay-window actions (space, pin, reset) need the REDnode host and show only on a page's only `rn-window`. `no-space`, `no-rollup` and `no-debug` leave one out.

## Themes

Put `theme="rednode"` (the default), `theme="hud"` (HUD red, like the game's own HUD) or `theme="edge"` (EDGE, solid yellow title bars) on any element. Everything inside it follows. The old names `game` and `yellow` still work.

| Theme | Look |
|---|---|
| `rednode` | The REDnode HUD house style: near-black panels, yellow and cyan accents |
| `game` | A look-alike of the game's own UI, rebuilt in CSS: red accents, teal highlights, soft glow. No game textures or fonts are used |
| `yellow` | The house style with solid yellow window title bars and dark title text |

**The player's theme.** The player picks a theme for every window in the REDnode launcher (**Theme** at the bottom). The kit applies it to the whole page and follows changes at once. An app that sets `theme` on its `<html>` keeps its own theme; one that sets it on an inner element, such as `<body>`, keeps it inside that element. The Coords HUD, Vitals and Native button apps set `theme="hud"` on `<body>`, so they stay game-styled.

Themes are CSS custom properties, so an app can adjust one: `--rn-bg`, `--rn-panel`, `--rn-panel-2`, `--rn-line`, `--rn-fg`, `--rn-dim`, `--rn-accent`, `--rn-accent-2`, `--rn-on-accent`, `--rn-danger`, `--rn-ok`, `--rn-display`, `--rn-body`, `--rn-mono`, `--rn-cut`, `--rn-glow`. Window title bars have their own: `--rn-title-bg` (and `--rn-title-bg-dim` when the window does not have focus), `--rn-title-fg`, `--rn-title-dim`, `--rn-title-ok`, `--rn-title-mark`, `--rn-title-line`, `--rn-title-hover-bg`, `--rn-title-hover-fg`.

## Components

| Element | Attributes | Events (`detail`) |
|---|---|---|
| `rn-window` | `title`, `draggable` (title area becomes the drag handle), `closable`, `no-space`, `no-rollup`, `no-debug` (leave that title-bar action out). Slots: default, `status` (right of the title), `footer` | `close` (cancelable; hides the window unless cancelled) |
| `rn-panel` | `title` | |
| `rn-button` | `variant`: `ghost` or `danger`; `disabled`; `sound`, `hover-sound` | normal `click` |
| `rn-toggle` | `label`, `checked`, `disabled`, `sound` | `change` (`{ checked }`) |
| `rn-slider` | `label`, `min`, `max`, `step`, `value`, `unit`, `sound` | `input`, `change` (`{ value }`) |
| `rn-input` | `label`, `placeholder`, `value`, `type` | `input`, `change`, `submit` on Enter (`{ value }`) |
| `rn-list` with `rn-item` | items: `value`, `selected`, `disabled`, slot `end`. List: `sound`. Height: `--rn-list-height` | `select` (`{ value, item }`) |
| `rn-menu` with `rn-menu-item` | menu: `title`, `sound`. Items: `value`, `disabled`, slot `end` | `select` (`{ value, item }`) |
| `rn-tabs` with `rn-tab` | tabs: `label`, `active`. Tabs: `sound` | `change` (`{ index, label }`) |
| `rn-progress` | `value` (leave out for an animated bar), `max`, `label` | |
| `rn-tooltip` | `text`. Wraps the element it explains | |
| `rn-notification` | `type`: `success`, `warning` or `error`; `title` | |

Properties: `rn-toggle.checked`, `rn-slider.value`, `rn-input.value`, `rn-list.value`.

Tooltips: any element with a `title` gets a tooltip drawn by the kit after half a second's hover, also inside the components (the title-bar icons). Overlay windows are drawn off screen, where the browser's own tooltips never show. On `rn-window`, `rn-panel`, `rn-menu` and `rn-notification` the `title` is the heading, so it gets none. Use `rn-tooltip` for a tooltip that shows on focus too.

## Script API

```js
RednodeUI.notify('Stash sorted', { title: 'Stash', type: 'success', theme: 'game', timeout: 4000 });
RednodeUI.playSound('ui_menu_onpress');               // through the game, via the bridge
RednodeUI.sounds.press = 'ui_menu_onpress';           // default sound for every press
```

## Keyboard

| Where | Keys |
|---|---|
| Everywhere | Tab and Shift+Tab move between widgets. Enter or Space presses |
| Lists and menus | Up and Down move, Home and End jump, Enter or Space chooses |
| Tabs | Left and Right switch tabs |
| Sliders | Arrow keys step |

Gamepad navigation is planned but not in O2: the game reads the controller too, so it needs a way to stop the game reacting first.

## Sounds

`sound` and `hover-sound` play a game sound event through the bridge call `audio.play`, which uses the game's `AudioSystem.Play`. Confirmed in game on 2.31: `ui_menu_onpress`, `ui_menu_hover`, `ui_menu_tutorial_close`, `ui_loot_take_all`, `ui_menu_item_bought`, `ui_jingle_quest_success`. Unknown names play nothing. Outside the game, sounds are skipped silently. Examples: [Overlay apps](https://edgemodders.github.io/REDnode/overlay-apps.html#playing-game-sounds).
