// Game API mod: reads and changes the game through `api`, the generic game API.
// Every call here is a plain game function, typed from the game's own type
// data. The Vitals app reads the same values from a web page.

import { api, game, ui } from 'rednode';

// V's health, level and money, the way scripts read them.
async function vitals() {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error('No player. Load a save first.');
  const statsId = await api.$call('Cast;EntityID;StatsObjectID', await player.GetEntityID());
  const pools = await api.GameInstance.GetStatPoolsSystem(game.instance);
  const stats = await api.GameInstance.GetStatsSystem(game.instance);
  const shop = await api.GameInstance.GetTransactionSystem(game.instance);
  const money = await api.MarketSystem.Money();
  return {
    player,
    health: await pools.GetStatPoolValue(statsId, 'Health', false),
    level: await stats.GetStatValue(statsId, 'Level'),
    money: await shop.GetItemQuantity(player, money),
  };
}

const health = ui.text('Health: -');
const level = ui.text('Level: -');
const money = ui.text('Eddies: -');
const result = ui.text('', { tone: 'dim' });
let firstPlayer = null; // the player reference from before the last save load

const show = (text, tone = 'normal') => result.set({ text, tone });

ui.window({
  title: 'Game API mod',
  anchor: 'left',
  x: 40,
  y: -60,
  width: 380,
  height: 400,
  children: [
    ui.heading('V, through the game API'),
    health,
    level,
    money,
    ui.button('Give 100 eddies', async () => {
      try {
        const player = await api.GetPlayer(game.instance);
        const shop = await api.GameInstance.GetTransactionSystem(game.instance);
        const ok = await shop.GiveItem(player, await api.MarketSystem.Money(), 100);
        show(ok ? 'TransactionSystem.GiveItem: 100 eddies given' : 'GiveItem returned false', ok ? 'accent' : 'danger');
        console.log(`GiveItem returned ${ok}`);
      } catch (err) {
        show(err.message, 'danger');
      }
    }),
    ui.button('Wrong argument type', async () => {
      try {
        const stats = await api.GameInstance.GetStatsSystem(game.instance);
        await stats.GetStatValue('not a stats id', 'Level'); // a string where a struct belongs
        show('The call should have failed', 'danger');
      } catch (err) {
        show(`Refused, as it should be: ${err.message}`, 'accent');
        console.log(`Wrong argument type: ${err.message}`);
      }
    }, { variant: 'ghost' }),
    ui.button('Use the player from before', async () => {
      if (!firstPlayer) return show('No reference kept yet', 'dim');
      try {
        const p = await firstPlayer.GetWorldPosition();
        show(`Still valid: X ${p.X.toFixed(1)} Y ${p.Y.toFixed(1)}`, 'accent');
      } catch (err) {
        show(err.message, 'accent');
        console.log(`Old reference: ${err.message}`);
      }
    }, { variant: 'ghost' }),
    result,
  ],
});

async function refresh() {
  try {
    const v = await vitals();
    firstPlayer ??= v.player;
    health.set({ text: `Health: ${Math.round(v.health)}` });
    level.set({ text: `Level: ${v.level}` });
    money.set({ text: `Eddies: ${v.money}` });
  } catch (err) {
    health.set({ text: err.message });
  }
}
setInterval(refresh, 1000);
refresh();

// Keep the reference from before a load, to show it no longer works after it.
game.on('PlayerPuppet.OnGameAttached', () => {
  console.log('Save loaded: references from before are now invalid');
  setTimeout(async () => {
    const v = await vitals().catch(() => null);
    if (v && firstPlayer && firstPlayer !== v.player) show('A save loaded: try "Use the player from before"', 'dim');
  }, 2000);
});

console.log('Game API mod started');
