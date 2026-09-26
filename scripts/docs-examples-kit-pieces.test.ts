import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as engine from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { leafTexture, matcapBall, type MatcapLook } from '../site/examples/kit/painted.ts';
import { walkingRobot } from '../site/examples/kit/robot.ts';
import { vehicles } from '../site/examples/kit/vehicles.ts';

// The SHA-256 of each picture's pixels as its page painted it before the kit held it.
const LEAF = '6b09b3416dd339495616ba4f399ca2e3d852a5639f780c18ccf57a8f74128c21';
const BALLS: [MatcapLook, string][] = [
  [
    { base: [0.55, 0.16, 0.08], shine: 0.08, gloss: 6, wrap: 0.3, rim: [0.25, 0.1, 0.05] },
    'fcc8e70194c8beee7fd8edc46216aafe3eefc5f8d4537925e014a5f36da170b8',
  ],
  [
    { base: [0.9, 0.92, 0.95], metal: 1, shine: 1.2, gloss: 120 },
    'a6b5e8680f860fc59481293eb6f7cb6388674ca9a89f363fd1bd5a9812a2a5e4',
  ],
  [
    { base: [1, 0.72, 0.3], metal: 0.9, shine: 0.9, gloss: 60 },
    '3aaf4be1cd12ada62a09c2408685d4d7448fb33ff8123bec17b40627ebb6829d',
  ],
  [
    { base: [0.12, 0.42, 0.26], shine: 0.5, gloss: 40, wrap: 0.6, rim: [0.2, 0.6, 0.4] },
    'eec27cca67386c75ba84c35ee9f0c78053d9d901935aaf489d8bb3213df5396d',
  ],
  [
    { base: [0.82, 0.78, 0.8], shine: 0.35, gloss: 25, wrap: 0.4, rim: [0.35, 0.3, 0.55] },
    'd8608e9ad6b62c4646a9b0c6b4f61bc3cb2a6c12b3633ae9c4956504cdb495c7',
  ],
  [
    { base: [0.03, 0.03, 0.04], metal: 0.35, shine: 1.4, gloss: 200, rim: [0.2, 0.25, 0.4] },
    'bb35269af0df93f446200be44fbbd8e9e8215a51c0bdfdb79d65948c734c14c9',
  ],
];

test('the leaf and the matcap balls are painted to the byte as their pages painted them', (t) => {
  let pixels: Uint8ClampedArray = new Uint8ClampedArray();
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (image: { data: Uint8ClampedArray }) => (pixels = image.data),
  };
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) } });
  t.after(() => Reflect.deleteProperty(globalThis, 'document'));
  const texture = { canvas: () => createHash('sha256').update(pixels).digest('hex') };
  assert.equal(leafTexture({ texture } as never), LEAF);
  assert.equal(pixels.length, 256 * 256 * 4);
  for (const [look, sha] of BALLS)
    assert.equal(matcapBall({ texture, math: engine.math } as never, look), sha);
});

test('the robot is its named joints, and plays its three clips at once', () => {
  const { robot, paint, actions, walkRound } = walkingRobot(engine);
  const names: string[] = [];
  robot.traverse((node) => void (node.name && names.push(node.name)));
  assert.deepEqual(names, ['hips', 'head', 'armL', 'armR', 'legL', 'legR']);
  assert.deepEqual(Object.keys(actions), ['walk', 'wave', 'dance']);
  assert.deepEqual(
    Object.values(actions).map(({ clip }) => [clip.name, clip.duration, clip.tracks.length]),
    [
      ['walk', 1, 5],
      ['wave', 0.8, 2],
      ['dance', 1.2, 3],
    ],
  );
  let meshes = 0;
  robot.traverse((node) => void ('material' in node && meshes++));
  // Hips and head, two eyes, and a bone and a hand on each limb; the paint is the body's.
  assert.equal(meshes, 12);
  assert.equal(paint.color.getHexString(), 'f2b134');
  // A quarter of the way round a 2 m circle: on +x, facing along the circle.
  walkRound(Math.PI / 2, 2);
  assert.deepEqual(robot.position.toArray().map(Math.round), [2, 0, 0]);
  assert.equal(robot.rotation.y, Math.PI);
});

test('the vehicles park on the ground, shaped as they are drawn, the camera behind', async () => {
  const camera = new Camera('perspective');
  const world = { camera, raycast: async () => ({ point: { y: 2 } }) };
  const { car, motorcycle, tracked, park, chase, groundAt } = vehicles(world as never, engine, {
    above: 60,
  });
  assert.equal(await groundAt(5, 5), 2);
  const built = [car(), motorcycle(), tracked()];
  for (const entry of built) await park(entry, [0, 20]);
  assert.deepEqual(
    built.map(({ driver, wheels, body }) => [
      driver.kind,
      wheels.length,
      body.physics?.shape?.type === 'compound'
        ? body.physics.shape.parts.map(({ type }) => type).join(' ')
        : '',
    ]),
    [
      ['car', 4, 'box box box box box box box'],
      ['motorcycle', 2, 'box box box box sphere box'],
      ['tracked', 12, 'box box cylinder box box'],
    ],
  );
  // It rests a little above the ground on its wheels, at its spot, level and facing -z.
  const rounded = (vector: { toArray(): number[] }) =>
    vector.toArray().map((value) => Math.round(value * 100) / 100);
  const [first] = built;
  assert.deepEqual(rounded(first.body.position), [0, 2.83, 20]);
  assert.equal(first.body.physics?.mass, 1470);
  assert.deepEqual(first.body.quaternion.toArray(), [0, 0, 0, 1]);
  chase(first, 1e9);
  assert.deepEqual(rounded(camera.position), [0, 5.23, 27.5]);
});

test('a vehicle with no ground below it fails by name', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const world = { camera: new Camera('perspective'), raycast: async () => null };
  const { car, park } = vehicles(world as never, engine, { above: 60 });
  const parked = park(car(), [3, 4]);
  for (let tick = 0; tick < 300; tick++) {
    await new Promise(setImmediate);
    t.mock.timers.tick(100);
  }
  await assert.rejects(parked, /No ground below \[3, 4\] from 60 m after 30 s/);
});

test('the pages build their pieces with the kit and keep no copy', () => {
  const page = (name: string) =>
    readFileSync(new URL(`../site/examples/${name}.html`, import.meta.url), 'utf8');
  // #799: the health check gathers all four.
  const gathered = page('health-check');
  for (const [name, piece, copy] of [
    ['drive-a-car', 'vehicles', 'chassis'],
    ['a-robot-that-walks-and-waves', 'walkingRobot', 'animation.clip('],
    ['leaves-cut-by-alpha', 'leafTexture', 'createImageData'],
    ['a-matcap-sculpture', 'matcapBall', 'createImageData'],
  ]) {
    for (const [source, of] of [
      [page(name), name],
      [gathered, 'health-check'],
    ]) {
      assert.match(
        source,
        new RegExp(`import \\{[^}]*\\b${piece}\\b[^}]*\\} from '../runtime/kit.js'`),
      );
      assert.ok(!source.includes(copy), `${of} keeps no copy of ${piece}`);
    }
  }
});
