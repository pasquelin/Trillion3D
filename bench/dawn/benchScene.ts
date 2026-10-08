// The bench's one scene: a page the bench writes itself, an open world carrying every cost the
// engine counts at once — a wide field of instanced blocks (cost follows the view, not the world),
// a dense pebble bed under a low sun (the worst sun-shadow projection), see-through panes and a
// water sheet (transparents), a ring of point lights (dynamic light), TAA on all. The scenario
// `world` flies over it, low, and holds still. No example is named: the page is generated.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
import type { Scenario } from './scenario.ts'

/** The name `run.ts` takes for this scene instead of an example's. */
export const BENCH_SCENE = 'bench-scene'

/** The extent of the block field, metres, and its count per side. */
const FIELD = { span: 1200, side: 250 }
/** The pebble bed beside the camera path: its count and its half extent, metres. */
const BED = { count: 10000, half: 9 }

/** The page's module script: every placement comes from a seeded sequence, the same on each run. */
function script() {
  return `
import { createWorld, geometry, light, material, math, object } from '../runtime/engine.js';
import { seeded } from '../runtime/kit.js';

const FIELD = ${JSON.stringify(FIELD)}, BED = ${JSON.stringify(BED)};
const world = createWorld('view');
world.scene.background = math.color('#cfd8e6');
world.camera.far = FIELD.span * 2;
const next = seeded(11);

const ground = object.mesh(geometry.box(FIELD.span * 2, 0.2, FIELD.span * 2),
  material.meshStandard({ color: '#9aa27e', roughness: 0.95 }));
ground.position.y = -0.1;
ground.receiveShadow = true;
world.scene.add(ground);

const block = geometry.box(1, 1, 1);
const walls = Array.from({ length: 8 }, (_, k) =>
  material.meshStandard({ color: math.color('#c8b9a4').lerp(math.color('#7f8fa6'), k / 7), roughness: 0.7 }));
const step = FIELD.span / FIELD.side;
for (let i = 0; i < FIELD.side; i++) for (let j = 0; j < FIELD.side; j++) {
  if (next() < 0.55) continue;
  const tall = 2 + next() * next() * 30;
  const mesh = object.mesh(block, walls[(i + j) % 8]);
  mesh.scale.set(step * (0.4 + next() * 0.4), tall, step * (0.4 + next() * 0.4));
  mesh.position.set((i - FIELD.side / 2) * step, tall / 2, (j - FIELD.side / 2) * step);
  mesh.castShadow = mesh.receiveShadow = true;
  world.scene.add(mesh);
}

const pebble = geometry.sphere(0.08, 12, 12);
const stones = Array.from({ length: 6 }, (_, k) =>
  material.meshStandard({ color: math.color('#f4efe4').lerp(math.color('#2f6f8f'), k / 5), roughness: 0.35 }));
for (let k = 0; k < BED.count; k++) {
  const mesh = object.mesh(pebble, stones[k % 6]);
  mesh.position.set((next() - 0.5) * 2 * BED.half, 0.03, (next() - 0.5) * 2 * BED.half);
  mesh.scale.set(0.7 + next(), 0.5 + next() * 0.4, 0.7 + next() * 0.8);
  mesh.castShadow = mesh.receiveShadow = true;
  world.scene.add(mesh);
}

const glass = material.meshStandard({ color: '#9fd4ff', roughness: 0.05, transparent: true,
  opacity: 0.35, depthWrite: false, side: 'double' });
for (let k = 0; k < 6; k++) {
  const pane = object.mesh(geometry.plane(3, 2, 1, 1), glass);
  pane.position.set(-6 + k * 2.4, 1.2, 3 - (k % 2) * 1.5);
  pane.rotation.y = 0.3 * (k - 2.5);
  world.scene.add(pane);
}
const sea = object.mesh(geometry.plane(60, 40, 112, 80), material.meshStandard({ color: '#1d6d8c',
  roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.8, depthWrite: false, side: 'double' }));
sea.rotation.x = -Math.PI / 2;
sea.position.set(30, 0.05, -40);
world.scene.add(sea);

for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  world.scene.add(light.point({ color: k % 2 ? '#ffb45e' : '#8ec5ff', intensity: 14, distance: 9,
    position: [Math.cos(a) * 6, 1.4, Math.sin(a) * 6] }));
}
const sun = light.directional({ intensity: 3.5, color: '#ffc58a', castShadow: true });
sun.position.set(-60, 28, 40);
world.scene.add(sun, light.hemisphere({ intensity: 1, color: '#9fb4ff', groundColor: '#8a7456' }));
world.camera.position.set(0, 60, 400);
world.camera.lookAt(0, 0, 0);
`
}

/** The page's text. */
export const benchSceneHtml = () => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Bench scene</title></head>
  <body>
    <canvas id="view"></canvas>
    <script type="module">${script()}</script>
  </body>
</html>
`

/** Writes the page in the measure folder and returns its path. */
export function writeBenchScene() {
  const out = measureOutput('bench-gpu', 'pages')
  mkdirSync(out, { recursive: true })
  const file = join(out, `${BENCH_SCENE}.html`)
  writeFileSync(file, benchSceneHtml())
  return file
}

const pose = (position: [number, number, number], target: [number, number, number]) => ({
  position,
  target,
})

/** The scenario flown over the scene: a high approach to the field's edge, a low glide between the
 *  blocks, the pebble bed close under the low sun, then a still image. */
export const WORLD_SCENARIO: Scenario = {
  name: 'world',
  page: BENCH_SCENE,
  segments: [
    {
      name: 'approach',
      frames: 240,
      camera: { from: pose([0, 60, 400], [0, 0, 0]), to: pose([0, 25, 120], [0, 5, -80]) },
      capture: true,
    },
    {
      name: 'glide',
      frames: 240,
      camera: { from: pose([0, 6, 60], [0, 4, -60]), to: pose([30, 3, -20], [30, 3, -160]) },
      capture: true,
    },
    {
      name: 'bed',
      frames: 240,
      camera: { from: pose([2.2, 0.9, 3.2], [-1, 0, -1]), to: pose([-2.2, 0.7, 2.4], [1, 0, -1]) },
      capture: true,
    },
    { name: 'still', frames: 240, capture: true },
  ],
}
