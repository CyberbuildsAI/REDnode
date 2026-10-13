// Test timer: a stopwatch for in-game tests. Every Start, Mark and note is written
// to the Mod log (and red4ext/logs/rednode-mods.log) with the clock time, so the
// lines a test produces can be matched to the steps the player took.

import { ui } from 'rednode';

let startedAt = 0; // Date.now() when started; 0 when stopped
let heldMs = 0; // time counted before the last pause
let step = 0;

const elapsed = () => heldMs + (startedAt ? Date.now() - startedAt : 0);
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const time = ui.heading('00:00');
const status = ui.text('Press Start, then Mark after each step.', { tone: 'dim' });
const last = ui.text('', { tone: 'accent' });
const start = ui.button('Start', () => {
  if (startedAt) {
    heldMs = elapsed();
    startedAt = 0;
    console.log(`Paused at ${clock(heldMs)}`);
  } else {
    startedAt = Date.now();
    console.log(heldMs ? `Resumed at ${clock(heldMs)}` : 'Started');
  }
  show();
});

function show() {
  time.set({ text: clock(elapsed()) });
  start.set({ label: startedAt ? 'Pause' : heldMs ? 'Resume' : 'Start' });
  status.set({ text: startedAt ? `Running · next is step ${step + 1}` : heldMs ? 'Paused' : 'Press Start, then Mark after each step.' });
}

ui.window({
  title: 'Test timer',
  anchor: 'left',
  x: 40,
  y: 0,
  width: 320,
  height: 290,
  children: [
    time,
    status,
    ui.row(
      start,
      ui.button('Mark', () => {
        if (!startedAt) {
          startedAt = Date.now() - heldMs;
          heldMs = 0;
          console.log('Started');
        }
        step += 1;
        const at = clock(elapsed());
        console.log(`Mark: step ${step} done at ${at}`);
        last.set({ text: `Step ${step} marked at ${at}` });
        show();
      }),
      ui.button('Reset', () => {
        console.log(`Reset at ${clock(elapsed())} after ${step} step(s)`);
        startedAt = 0;
        heldMs = 0;
        step = 0;
        last.set({ text: '' });
        show();
      }, { variant: 'ghost' }),
    ),
    ui.input({
      placeholder: 'A note for the log (Enter)',
      onSubmit: (text) => {
        if (!text.trim()) return;
        console.log(`Note at ${clock(elapsed())}, after step ${step}: ${text.trim()}`);
        last.set({ text: 'Note written to the log' });
      },
    }),
    last,
  ],
});

setInterval(() => {
  if (startedAt) time.set({ text: clock(elapsed()) });
}, 1000);

console.log('Test timer ready');
