// Signal: a small round HUD widget. Tests a second window, dragging by a tab,
// and click-through on the transparent hole in the middle.
'use strict';

const $ = (id) => document.getElementById(id);
const RADIUS = 128;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Tick marks around the ring, every 5 seconds; majors every 15.
const ticks = $('ticks');
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * 2 * Math.PI;
  const major = i % 3 === 0;
  const r1 = 145;
  const r2 = major ? 156 : 151;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', 160 + Math.sin(a) * r1);
  line.setAttribute('y1', 160 - Math.cos(a) * r1);
  line.setAttribute('x2', 160 + Math.sin(a) * r2);
  line.setAttribute('y2', 160 - Math.cos(a) * r2);
  if (major) line.classList.add('major');
  ticks.appendChild(line);
}

// The sweep fills the ring once a minute.
const sweep = $('sweep');
sweep.style.strokeDasharray = `0 ${CIRCUMFERENCE}`;
function tick() {
  const now = new Date();
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const length = (seconds / 60) * CIRCUMFERENCE;
  sweep.style.strokeDasharray = `${length} ${CIRCUMFERENCE}`;
  $('time').textContent = now.toTimeString().slice(0, 8);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

$('ping').addEventListener('click', async () => {
  const started = performance.now();
  try {
    const r = await window.rednode.call('game.info');
    $('frame').textContent = `FRAME ${r.frame} · ${(performance.now() - started).toFixed(0)} MS`;
  } catch (err) {
    $('frame').textContent = 'NO ANSWER';
  }
});

window.rednode.on((m) => {
  if (m.event === 'link') $('frame').textContent = m.connected ? 'LINKED' : 'NO GAME';
  if (m.event === 'hello') $('frame').textContent = 'LINKED';
  if (m.event === 'focus') document.body.classList.toggle('unfocused', !m.focused);
});
