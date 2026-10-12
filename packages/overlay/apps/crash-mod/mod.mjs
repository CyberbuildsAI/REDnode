// Crash mod: four ways for a mod to fail. Each button tests what REDnode
// contains. Use it with the launcher's Shared process switch to compare.

import { ui } from 'rednode';

ui.window({
  title: 'Crash mod',
  anchor: 'left',
  x: 40,
  y: 0,
  width: 340,
  height: 330,
  children: [
    ui.text('Each button breaks this mod in a different way. Other mods should keep running.', { tone: 'dim' }),
    ui.button('Throw an error', () => {
      throw new Error('Crash mod threw this on purpose');
    }, { variant: 'danger' }),
    ui.button('Hang forever', () => {
      console.log('Hanging now: an endless loop');
      for (;;) {
        // never returns
      }
    }, { variant: 'danger' }),
    ui.button('Exit', () => {
      console.log('Calling process.exit(3)');
      process.exit(3);
    }, { variant: 'danger' }),
    ui.button('Kill the process', () => {
      // Ends the whole mod process at once, the way a crash in native code would.
      console.log('Killing the mod process');
      process.kill(process.pid, 'SIGKILL');
    }, { variant: 'danger' }),
  ],
});

console.log('Crash mod ready');
