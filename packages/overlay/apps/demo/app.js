// Demo overlay app. Every tile tests one step of the proof of concept.
'use strict';

const $ = (id) => document.getElementById(id);

// Step 1 + 2: live rendering. The clock and bar change every frame.
let rafCount = 0;
function tick(now) {
  const d = new Date();
  $('clock').textContent = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  $('sweep').style.left = `${((now / 20) % 130) - 22}%`;
  $('raf').textContent = ++rafCount;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Step 3: input.
let clicks = 0;
$('click').addEventListener('click', () => {
  $('clicks').textContent = ++clicks;
});
document.addEventListener('keydown', (e) => {
  $('key').textContent = e.key === ' ' ? 'Space' : e.key;
});

// Step 4: bridge calls.
async function call(method, format) {
  const out = $('result');
  out.className = 'mono result';
  out.textContent = `Calling ${method}...`;
  const started = performance.now();
  try {
    const result = await window.rednode.call(method);
    const ms = (performance.now() - started).toFixed(1);
    out.className = 'mono result ok';
    out.textContent = `${format(result)}  (${ms} ms)`;
  } catch (err) {
    out.className = 'mono result err';
    out.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}
$('pos').addEventListener('click', () =>
  call('player.position', (p) => `X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)}  Z ${p.z.toFixed(2)}`),
);
$('info').addEventListener('click', () => call('game.info', (r) => `REDnode frame ${r.frame}`));

// Status and events from the game.
function setLink(connected) {
  $('link').textContent = connected ? 'GAME LINKED' : 'NO GAME';
  $('link').className = `pill ${connected ? 'on' : 'off'}`;
}
function setMode(mode) {
  $('mode').textContent = (mode || 'passive').toUpperCase();
  $('mode').className = `pill${mode === 'interactive' ? ' hot' : ''}`;
}
function addEvent(html) {
  const list = $('events');
  if (list.firstElementChild?.classList.contains('dim')) list.innerHTML = '';
  const li = document.createElement('li');
  li.innerHTML = `<span class="dim">${new Date().toTimeString().slice(0, 8)}</span> ${html}`;
  list.prepend(li);
  while (list.children.length > 6) list.lastElementChild.remove();
}

window.rednode.on((m) => {
  if (m.event === 'link') {
    setLink(m.connected);
    addEvent(m.connected ? '<b>link</b> connected to the game' : '<b>link</b> lost');
  } else if (m.event === 'hello') {
    setLink(true);
    setMode(m.mode);
    addEvent(`<b>hello</b> ${m.plugin}`);
  } else if (m.event === 'overlay') {
    setMode(m.mode);
    addEvent(`<b>mode</b> ${m.mode}`);
  } else if (m.event === 'game') {
    addEvent(`<b>${m.name.split(' ')[0]}</b> value ${m.value}, frame ${m.frame}`);
  }
});

window.rednode.state().then((s) => {
  setLink(s.connected);
  setMode(s.mode);
  $('windowed').hidden = !s.windowed;
});
