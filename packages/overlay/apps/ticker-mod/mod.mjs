// Ticker mod: no window, only the log. Its output goes to
// red4ext/logs/rednode-mods.log, each line tagged [ticker-mod].

import { game } from 'rednode';

setInterval(async () => {
  try {
    const p = await game.player.position();
    console.log(`V is at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`);
  } catch (err) {
    console.log(`No position: ${err.message}`);
  }
}, 10000);

game.on('PlayerPuppet.OnGameAttached', (e) => console.log(`Game event ${e.name} = ${e.value}, frame ${e.frame}`));

game.onState((s) => console.log(`State: ${JSON.stringify(s)}`));

console.log('Ticker mod started');
