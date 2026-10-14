// World test: the W1 world API end to end. api.$new builds a mesh component (its
// mesh set by a depot path), world.spawn places an empty entity with it in front of
// V, world.move moves it, and world.remove takes it away. The entity events and the
// moves per second go to the Mod log.

import { api, game, ui, world } from 'rednode';

// Base-game assets only (issue #6): a bare entity with no components or appearances
// (a suitcase placeholder), a textured cardboard box, and the level-design kit's marker.
// (The kit's "orange" box has only an untextured editor material and shows black.)
const TEMPLATE = 'base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent';
const MESHES = [
  'base\\environment\\decoration\\containers\\packaging\\cardboard_box\\cardboard_box_a_closed.mesh',
  'base\\environment\\ld_kit\\marker.mesh',
];

let spawned = null; // { id, at: {x, y, z} }
let meshIndex = 0;

const status = ui.text('Checking...', { tone: 'dim' });
const result = ui.text('');
const events = ui.text('', { tone: 'dim' });
const eventLines = [];

world.on('Entity/Initialize', show);
world.on('Entity/AfterAttach', show);
world.on('Entity/Detach', show);
function show(e) {
  const line = `${e.name} ${e.entityType} ${e.entityId}`;
  console.log(line);
  eventLines.push(line);
  events.set({ text: eventLines.slice(-4).join('\n') });
}

async function inFront(metres) {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error('No player: load a save first');
  const p = await player.GetWorldPosition();
  const f = await player.GetWorldForward();
  return { x: p.X + f.X * metres, y: p.Y + f.Y * metres, z: p.Z };
}

async function spawn() {
  if (spawned) await remove();
  const mesh = MESHES[meshIndex % MESHES.length];
  try {
    const at = await inFront(3);
    const started = Date.now();
    const component = await api.$new('entMeshComponent', {
      name: 'rednode_test_mesh',
      mesh,
      meshAppearance: 'default',
      visualScale: { X: 1, Y: 1, Z: 1 },
    });
    const { id } = await world.spawn({ template: TEMPLATE, position: at, components: [component] });
    spawned = { id, at };
    result.set({ text: `Spawned ${id.hash} in ${Date.now() - started} ms, mesh ${mesh}` });
    console.log(`Spawned ${id.hash} with ${mesh} in ${Date.now() - started} ms`);
  } catch (err) {
    result.set({ text: err.message, tone: 'danger' });
    console.log(`Spawn failed: ${err.message}`);
  }
}

// Moves the box in a circle for 5 seconds, one move after another, then 10 at a
// time, and reports how many moves the game took per second each way.
async function spin() {
  if (!spawned) return result.set({ text: 'Spawn first' });
  const run = async (parallel) => {
    let moves = 0;
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const batch = Array.from({ length: parallel }, (_, k) => {
        const a = (moves + k) / 20;
        return world.move(spawned.id, { x: spawned.at.x + Math.cos(a), y: spawned.at.y + Math.sin(a), z: spawned.at.z }, undefined, (a * 180) / Math.PI);
      });
      await Promise.all(batch);
      moves += parallel;
    }
    return moves / 5;
  };
  result.set({ text: 'Spinning...' });
  const one = await run(1);
  const ten = await run(10);
  const text = `${one.toFixed(0)} moves/s one at a time, ${ten.toFixed(0)} moves/s ten at a time`;
  result.set({ text });
  console.log(`Move rate: ${text}`);
}

async function remove() {
  if (!spawned) return;
  const ok = await world.remove(spawned.id).catch((err) => err.message);
  console.log(`Removed ${spawned.id.hash}: ${ok}`);
  result.set({ text: `Removed: ${ok}` });
  spawned = null;
}

ui.window({
  title: 'World test',
  anchor: 'left',
  x: 40,
  y: -120,
  width: 400,
  height: 330,
  children: [
    status,
    ui.row(
      ui.button('Spawn box', spawn),
      ui.button('Spin 10 s', spin, { variant: 'ghost' }),
      ui.button('Remove', remove, { variant: 'ghost' }),
    ),
    ui.button('Next mesh', () => {
      meshIndex += 1;
      result.set({ text: `Next spawn uses ${MESHES[meshIndex % MESHES.length]}` });
    }, { variant: 'ghost' }),
    result,
    events,
  ],
});

async function check() {
  const ok = await world.available();
  status.set({ text: ok ? 'World API ready (Codeware found)' : 'World API not available: needs Codeware and a loaded save', tone: ok ? 'accent' : 'dim' });
}
game.on('PlayerPuppet.OnGameAttached', check);
check();
console.log('World test ready');
