// UI kit test app. The UI is all markup in index.html; this file only wires events.
'use strict';

const $ = (id) => document.getElementById(id);

// Switch the whole window between the rednode and game themes.
$('theme').addEventListener('change', (e) => {
  $('win').setAttribute('theme', e.detail.checked ? 'game' : 'rednode');
});

$('primary').addEventListener('click', () => RednodeUI.notify('Primary button pressed', { title: 'Kit' }));

$('rain').addEventListener('input', (e) => {
  $('progress').setAttribute('value', e.detail.value);
});

$('name').addEventListener('submit', (e) => {
  RednodeUI.notify(`Call sign set to ${e.detail.value || 'nothing'}`, { type: 'success', title: 'Kit' });
});

$('list').addEventListener('select', (e) => RednodeUI.notify(`Selected ${e.detail.value}`, { title: 'List' }));
$('menu').addEventListener('select', (e) => RednodeUI.notify(`Menu: ${e.detail.value}`, { title: 'Menu' }));

// Sound tester: pick a name from the list or type one, then Play.
$('sounds').addEventListener('select', (e) => {
  $('sound').value = e.detail.value;
});
async function play() {
  const name = $('sound').value.trim();
  if (!name) return;
  try {
    await window.rednode.call('audio.play', { name });
    RednodeUI.notify(`Played ${name}. Silence means the name is unknown to the game.`, { title: 'Sound' });
  } catch (err) {
    RednodeUI.notify(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), {
      type: 'error',
      title: 'Sound',
    });
  }
}
$('play').addEventListener('click', play);
$('sound').addEventListener('submit', play);
