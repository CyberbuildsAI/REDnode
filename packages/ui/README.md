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

## Themes

Put `theme="rednode"` (the default) or `theme="game"` on any element. Everything inside it follows.

| Theme | Look |
|---|---|
| `rednode` | The REDnode HUD house style: near-black panels, yellow and cyan accents |
| `game` | A look-alike of the game's own UI, rebuilt in CSS: red accents, teal highlights, soft glow. No game textures or fonts are used |

Themes are CSS custom properties, so an app can adjust one: `--rn-bg`, `--rn-panel`, `--rn-panel-2`, `--rn-line`, `--rn-fg`, `--rn-dim`, `--rn-accent`, `--rn-accent-2`, `--rn-on-accent`, `--rn-danger`, `--rn-ok`, `--rn-display`, `--rn-body`, `--rn-mono`, `--rn-cut`, `--rn-glow`.

## Components

| Element | Attributes | Events (`detail`) |
|---|---|---|
| `rn-window` | `title`, `draggable` (title area becomes the drag handle), `closable`. Slots: default, `status` (right of the title), `footer` | `close` (cancelable; hides the window unless cancelled) |
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
