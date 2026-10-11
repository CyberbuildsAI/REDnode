// A native-looking button: a borderless window with only a game-style button
// and its menu. Everything else in the window is transparent.
'use strict';

const menu = document.getElementById('menu');

document.getElementById('open').addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  if (!menu.hidden) menu.querySelector('rn-menu-item')?.focus();
});

const messages = {
  sell: 'Sold 12 junk items for 340 eddies (demo only)',
  sort: 'Stash sorted by value (demo only)',
  disassemble: 'Nothing to disassemble (demo only)',
};

menu.addEventListener('select', (e) => {
  menu.hidden = true;
  if (e.detail.value !== 'close') RednodeUI.notify(messages[e.detail.value], { title: 'Stash', theme: 'game' });
});
