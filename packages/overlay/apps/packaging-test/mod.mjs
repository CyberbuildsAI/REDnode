// Packaging test: a sample of W2. Its rednode-app.json requires Codeware, ArchiveXL
// and a mod that does not exist, so the Mod Manager and this window show one missing.
// kernel.bridge() reaches REDbridge (WolvenKit's engine) to list and search the game's
// archives. Needs "permissions": ["bridge"] and the player's OK in the Mod Manager.

import { kernel, ui } from 'rednode';

let query = 'player_ma_tpp';

const requires = ui.text('Checking requirements...', { tone: 'dim' });
const bridgeLine = ui.text('Press Archives to start REDbridge.', { tone: 'dim' });
const results = ui.text('', { tone: 'dim' });

ui.window({
  title: 'Packaging test',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 440,
  height: 460,
  children: [
    requires,
    ui.row(ui.button('Archives', listArchives), ui.button('Search', search, { variant: 'ghost' })),
    ui.input({
      placeholder: 'Search the archives (Enter)',
      value: query,
      onChange: (v) => (query = v),
      onSubmit: (v) => {
        query = v;
        search();
      },
    }),
    bridgeLine,
    results,
  ],
});

// What rednode-app.json requires, checked against the game folder.
const checked = await kernel.requirements();
requires.set({
  text: checked.map((r) => `${r.ok ? 'OK' : 'MISSING'}  ${r.name} ${r.wants}  ${r.found ?? r.note}`).join('\n'),
  tone: checked.every((r) => r.ok) ? 'normal' : 'danger',
});
console.log(`Requirements: ${checked.map((r) => `${r.name} ${r.ok ? 'ok' : r.note}`).join(', ')}`);

async function bridge() {
  const b = await kernel.bridge();
  bridgeLine.set({ text: `REDbridge ${b.version ?? ''} from ${b.source}`, tone: 'dim' });
  return b;
}

async function listArchives() {
  try {
    const b = await bridge();
    const t0 = Date.now();
    const info = await b.call('bridge.info');
    const archives = await b.call('archive.archives');
    results.set({
      text: `${archives.length} archives, ${info.files} files (${Date.now() - t0} ms)\n` +
        archives.slice(0, 6).map((a) => `${a.name}  ${a.files}`).join('\n'),
      tone: 'normal',
    });
    console.log(`REDbridge: ${archives.length} archives, ${info.files} files`);
  } catch (err) {
    results.set({ text: err.message, tone: 'danger' });
    console.log(`REDbridge failed: ${err.message}`);
  }
}

async function search() {
  if (!query.trim()) return;
  try {
    const b = await bridge();
    const found = await b.call('archive.search', { query, limit: 8 });
    results.set({ text: `${found.total} found\n${found.items.map((f) => f.name).join('\n')}`, tone: 'normal' });
    console.log(`Searched "${query}": ${found.total} found`);
  } catch (err) {
    results.set({ text: err.message, tone: 'danger' });
    console.log(`Search failed: ${err.message}`);
  }
}
