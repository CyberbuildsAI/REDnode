// Hello mod: a Tier 2 Node mod with a window built by the ui builder.
// It runs in the REDnode host, outside the game. Edit this file while the game
// runs with hot reload on, and the mod restarts with the change.

import { game, ui } from 'rednode';

const VERSION = 'first version';

const where = ui.text('Waiting for the game...');
const state = ui.text('', { tone: 'dim' });
const loads = ui.text('Saves loaded since the mod started: 0', { tone: 'dim' });
let follow = true;
let presses = 0;

ui.window({
  title: 'Hello mod',
  anchor: 'right',
  x: -40,
  y: 0,
  width: 360,
  height: 340,
  children: [
    ui.heading('Where is V'),
    where,
    state,
    ui.row(
      ui.button('Play sound', async () => {
        presses += 1;
        await game.audio.play('ui_menu_onpress');
        console.log(`Sound button pressed ${presses} time(s)`);
      }),
      ui.toggle('Follow', (on) => {
        follow = on;
        console.log(`Follow ${on ? 'on' : 'off'}`);
      }, { checked: true }),
    ),
    loads,
    ui.text(`Mod code: ${VERSION}, loaded at ${new Date().toLocaleTimeString()}`, { tone: 'accent' }),
  ],
});

// The same call the Coords HUD app makes, so both show the same position.
setInterval(async () => {
  if (!follow) return;
  try {
    const p = await game.player.position();
    where.set({ text: `X ${p.x.toFixed(1)}   Y ${p.y.toFixed(1)}   Z ${p.z.toFixed(1)}`, tone: 'normal' });
  } catch (err) {
    where.set({ text: err.message, tone: 'dim' });
  }
}, 500);

game.onState((s) => {
  const shown = [s.menu && 'menu', s.photoMode && 'photo mode', s.scene && 'scene', s.mainMenu && 'main menu'].filter(Boolean);
  state.set({ text: s.connected ? `Game: ${shown.join(', ') || 'gameplay'} · overlay ${s.overlay}` : 'Game: not linked' });
});

let loaded = 0;
game.on('PlayerPuppet.OnGameAttached', (e) => {
  loaded += 1;
  loads.set({ text: `Saves loaded since the mod started: ${loaded}` });
  console.log(`PlayerPuppet.OnGameAttached on frame ${e.frame}`);
});

console.log(`Hello mod started (${VERSION})`);
