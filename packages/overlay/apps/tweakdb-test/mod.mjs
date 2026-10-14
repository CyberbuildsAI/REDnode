// TweakDB test: a sample of tweakdb in the rednode package (phase T1). Type a record's
// path; the window shows its type, a few of its flats and a method's answer. Vehicles
// lists every vehicle record. Reading needs nothing else installed.

import { tweakdb, ui } from 'rednode';

let path = 'Items.Preset_Lexington_Default';
const FLATS = ['quality', 'itemType', 'displayName', 'friendlyName', 'tags', 'iconPath'];

const status = ui.text('Press Read.', { tone: 'dim' });
const lines = ui.text('', { tone: 'normal' });

ui.window({
  title: 'TweakDB test',
  anchor: 'left',
  x: 40,
  y: 160,
  width: 460,
  height: 480,
  children: [
    ui.input({
      placeholder: 'A record path (Enter)',
      value: path,
      onChange: (v) => (path = v.trim()),
      onSubmit: (v) => {
        path = v.trim();
        read();
      },
    }),
    ui.row(ui.button('Read', read), ui.button('Vehicles', vehicles, { variant: 'ghost' })),
    status,
    lines,
  ],
});

const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

async function read() {
  if (!path) return;
  const t0 = Date.now();
  try {
    const type = await tweakdb.type(path);
    if (!type) {
      status.set({ text: `No record "${path}"`, tone: 'danger' });
      lines.set({ text: '' });
      return;
    }
    const out = [`type  ${type}`, `id  ${tweakdb.id(path)}`];
    // All at once: calls waiting when a game frame starts run in that frame.
    const flats = await Promise.all(FLATS.map((name) => tweakdb.flat(`${path}.${name}`)));
    FLATS.forEach((name, i) => {
      if (flats[i]) out.push(`${name}  ${show(flats[i].value)}  (${flats[i].type})`);
    });
    // A method of the record. Game objects answer to any name (the game decides which
    // methods exist), so pick one by the record's type: FriendlyName is an item's.
    const method = /Item_Record$/.test(type) ? 'FriendlyName' : 'DisplayName';
    const record = await tweakdb.record(path);
    try {
      out.push(`${method}()  ${show(await record[method]())}`);
    } catch (err) {
      out.push(`${method}()  ${err.message}`);
    }
    status.set({ text: `${path} in ${Date.now() - t0} ms`, tone: 'dim' });
    lines.set({ text: out.join('\n') });
    console.log(`Read ${path}: ${type}, ${out.length - 2} values in ${Date.now() - t0} ms`);
  } catch (err) {
    status.set({ text: err.message, tone: 'danger' });
    console.log(`Read failed: ${err.message}`);
  }
}

async function vehicles() {
  const t0 = Date.now();
  try {
    const ids = await tweakdb.records('Vehicle');
    const named = ids.filter((id) => !id.startsWith('0x')).length;
    status.set({ text: `${ids.length} vehicle records (${named} with known names) in ${Date.now() - t0} ms`, tone: 'dim' });
    lines.set({ text: ids.slice(0, 12).join('\n') });
    console.log(`Vehicles: ${ids.length} records in ${Date.now() - t0} ms`);
  } catch (err) {
    status.set({ text: err.message, tone: 'danger' });
    console.log(`Vehicles failed: ${err.message}`);
  }
}

console.log('TweakDB test ready');
