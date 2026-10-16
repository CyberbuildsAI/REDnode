// Sound test: the Sound API's S1 test (docs/sound.md). Plays the package's own files
// (sounds/, made by tools/sounds/make-sample-sounds.py) through REDnode's audio engine:
//   - music.ogg loops in the music category, beep.wav and chime.flac are effects,
//     voice.mp3 is dialogue; each follows its game volume slider;
//   - every sound pauses while a game menu is open;
//   - settings: pan, delay, pitch, fades.
// It also shows the game's slow-motion state, for the Sandevistan test.
// Everything it does goes to the Mod log as well.

import { api, audio, game, ui } from 'rednode';

const status = ui.text('Waiting for a loaded save...', { tone: 'dim' });
const playingLine = ui.text('', { tone: 'dim' });
const live = ui.text('', { tone: 'normal' });

let music = null;
const musicButton = ui.button('Music (OGG)', toggleMusic);

ui.window({
  title: 'Sound test',
  anchor: 'left',
  x: 40,
  y: 200,
  width: 470,
  height: 520,
  children: [
    ui.heading('Files'),
    ui.row(musicButton, ui.button('Beep (WAV)', () => play('beep'), { variant: 'ghost' }), ui.button('Chime (FLAC)', () => play('chime'), { variant: 'ghost' })),
    ui.row(ui.button('Voice (MP3)', () => play('voice'), { variant: 'ghost' }), ui.button('Voice +12 semitones', () => play('voice', { semitones: 12 }), { variant: 'ghost' })),
    ui.heading('Settings'),
    ui.row(
      ui.button('Chime left', () => play('chime', { pan: -1 }), { variant: 'ghost' }),
      ui.button('Chime right', () => play('chime', { pan: 1 }), { variant: 'ghost' }),
      ui.button('Beep in 2 s', () => play('beep', { delay: 2000 }), { variant: 'ghost' }),
    ),
    ui.row(ui.button('Music quieter', () => music?.set({ fadeTo: { volume: 0.3, ms: 1000 } }), { variant: 'ghost' }), ui.button('Music louder', () => music?.set({ fadeTo: { volume: 1, ms: 1000 } }), { variant: 'ghost' }), ui.button('Stop all', () => audio.stopAll({ fadeOut: 500 }), { variant: 'ghost' })),
    status,
    playingLine,
    ui.heading('Game time'),
    live,
  ],
});

async function play(name, options) {
  try {
    const sound = await audio.play(name, options);
    const what = `${name}${options ? ` ${JSON.stringify(options)}` : ''}`;
    status.set({ text: `Playing ${what}`, tone: 'dim' });
    console.log(`Play ${what}: sound ${sound.id}`);
    sound.ended.then((end) => console.log(`Sound ${sound.id} (${name}) ${end.why}${end.error ? `: ${end.error}` : ''}`));
    return sound;
  } catch (err) {
    status.set({ text: `${name}: ${err.message}`, tone: 'danger' });
    console.log(`Play ${name} failed: ${err.message}`);
    return null;
  }
}

async function toggleMusic() {
  if (music) {
    const m = music;
    music = null;
    musicButton.set({ label: 'Music (OGG)' });
    await m.stop({ fadeOut: 1500 });
    return;
  }
  const m = await play('music');
  if (!m) return;
  music = m;
  musicButton.set({ label: 'Stop music' });
  m.ended.then(() => {
    if (music !== m) return;
    music = null;
    musicButton.set({ label: 'Music (OGG)' });
  });
}

// What is playing, twice a second.
async function showPlaying() {
  try {
    const list = await audio.playing();
    playingLine.set({
      text: list.length ? list.map((s) => `${s.id} ${s.file.split(/[\\/]/).pop()} ${s.state} ${s.position.toFixed(1)}/${s.length.toFixed(1)} s`).join('\n') : 'Nothing playing',
    });
  } catch (err) {
    playingLine.set({ text: err.message });
  }
}

// Slow motion: the global dilation, and V's own (a Sandevistan slows the world, not V).
const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
let last = '';
async function readLive() {
  const out = [];
  try {
    const time = await api.GameInstance.GetTimeSystem(game.instance);
    out.push(`global dilation  ${fmt(await time.GetActiveTimeDilation('', false))}`);
  } catch (err) {
    out.push(`time: ${err.message}`);
  }
  try {
    const player = await api.GetPlayer(game.instance);
    out.push(`V's dilation  ${fmt(await player.GetTimeDilationValue())}${(await player.IsIgnoringGlobalTimeDilation()) ? ' (ignores global)' : ''}`);
  } catch (err) {
    out.push(`V: ${err.message}`);
  }
  out.push(`menu  ${state.menu}`);
  live.set({ text: out.join('\n') });
  const now = out.join(' · ');
  if (now !== last) console.log(`Now: ${now}`);
  last = now;
}

// Game calls wait for a loaded save: at the main menu there is no game to ask.
let state = await game.state();
let ready = false;
game.onState((s) => {
  state = s;
});
setInterval(() => {
  if (!state.mainMenu && state.connected) {
    if (!ready) status.set({ text: 'Ready: press a button', tone: 'dim' });
    ready = true;
    readLive();
    showPlaying();
  }
}, 500);
console.log('Sound test ready');
