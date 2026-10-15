// Sound test: the Sound API's research spike (docs/sound.md). It answers, in the game:
//   - where the game keeps its volume sliders, and their names and values;
//   - how to tell the game is paused, and how much time is slowed;
//   - where the listener is (the active camera);
//   - whether REDnode's own audio output (miniaudio, in the plugin) plays beside the game's.
// Everything it finds goes to the Mod log as well.

import { api, game, ui } from 'rednode';

const volumes = ui.text('Reading the audio settings...', { tone: 'dim' });
const live = ui.text('', { tone: 'normal' });
const tone = ui.text('', { tone: 'dim' });

ui.window({
  title: 'Sound test',
  anchor: 'left',
  x: 40,
  y: 200,
  width: 440,
  height: 470,
  children: [
    ui.row(ui.button('Play test tone', () => playTone(440)), ui.button('Low', () => playTone(220), { variant: 'ghost' }), ui.button('Read settings', readSettings, { variant: 'ghost' })),
    tone,
    volumes,
    live,
  ],
});

const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));

// The audio settings: every group under /audio and every setting in them.
async function readSettings() {
  try {
    const settings = await api.GameInstance.GetSettingsSystem(game.instance);
    const audio = await settings.GetGroup('/audio');
    const groups = audio ? await audio.GetGroups(false) : [];
    const lines = [];
    for (const g of [audio, ...groups]) {
      if (!g) continue;
      const path = await g.GetPath();
      for (const v of await g.GetVars(false)) {
        const name = await v.GetName();
        let value = '?';
        try {
          value = await v.GetValue();
        } catch {
          // a list or a bool: GetValue differs by type
        }
        lines.push(`${path}/${name}  ${fmt(value)}  (${v.$type.replace('userSettingsVar', '')})`);
      }
    }
    volumes.set({ text: lines.join('\n') || 'No settings under /audio', tone: 'normal' });
    console.log(`Audio settings:\n${lines.join('\n')}`);
  } catch (err) {
    volumes.set({ text: `Settings: ${err.message}`, tone: 'danger' });
    console.log(`Reading the audio settings failed: ${err.message}`);
  }
}

// Pause, slow motion and the camera, twice a second; changes go to the log.
let last = '';
async function readLive() {
  const out = [];
  try {
    const time = await api.GameInstance.GetTimeSystem(game.instance);
    out.push(`paused  ${await time.IsPausedState()}`);
    out.push(`dilation  ${fmt(await time.GetActiveTimeDilation('', false))}`);
  } catch (err) {
    out.push(`time: ${err.message}`);
  }
  try {
    const camera = await api.GameInstance.GetCameraSystem(game.instance);
    const r = await camera.GetActiveCameraWorldTransform({});
    // An out parameter: the answer is { result, out: { transform } }.
    const p = r?.out?.transform?.position;
    out.push(`camera  ${p ? [p.X, p.Y, p.Z].map((n) => Number(n).toFixed(1)).join(', ') : JSON.stringify(r).slice(0, 120)}`);
  } catch (err) {
    out.push(`camera: ${err.message}`);
  }
  live.set({ text: out.join('\n') });
  const now = out.slice(0, 2).join(' · ');
  if (now !== last) console.log(`Now: ${now}`);
  last = now;
}

// A tone through REDnode's own output (miniaudio in the plugin), not the game's.
async function playTone(hz) {
  try {
    const r = await game.call('audio.tone', { hz, ms: 800, volume: 0.2 });
    tone.set({ text: `${hz} Hz on "${r.device}", ${r.sampleRate} Hz, ${r.channels} channels (miniaudio ${r.miniaudio})`, tone: 'dim' });
    console.log(`Tone ${hz} Hz on "${r.device}", ${r.sampleRate} Hz, ${r.channels} channels`);
  } catch (err) {
    tone.set({ text: `Tone: ${err.message}`, tone: 'danger' });
    console.log(`Tone failed: ${err.message}`);
  }
}

console.log('Sound test ready');
readSettings();
setInterval(readLive, 500);
