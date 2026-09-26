import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as engine from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { fleet } from '../site/examples/kit/fleet.ts';
import { leafTexture, matcapBall, type MatcapLook } from '../site/examples/kit/painted.ts';
import { walkingRobot } from '../site/examples/kit/robot.ts';

// The SHA-256 of each picture's pixels as its page painted it before the kit held it.
const PAINTED = {
  leaf: '6b09b3416dd339495616ba4f399ca2e3d852a5639f780c18ccf57a8f74128c21',
  'red clay': 'fcc8e70194c8beee7fd8edc46216aafe3eefc5f8d4537925e014a5f36da170b8',
  chrome: 'a6b5e8680f860fc59481293eb6f7cb6388674ca9a89f363fd1bd5a9812a2a5e4',
  obsidian: 'bb35269af0df93f446200be44fbbd8e9e8215a51c0bdfdb79d65948c734c14c9',
};
const LOOKS: Record<string, MatcapLook> = {
  'red clay': { base: [0.55, 0.16, 0.08], shine: 0.08, gloss: 6, wrap: 0.3, rim: [0.25, 0.1, 0.05] },
  chrome: { base: [0.9, 0.92, 0.95], metal: 1, shine: 1.2, gloss: 120 },
  obsidian: { base: [0.03, 0.03, 0.04], metal: 0.35, shine: 1.4, gloss: 200, rim: [0.2, 0.25, 0.4] },
};

test('the leaf and the matcap balls are painted to the byte as their pages painted them', (t) => {
  let pixels = new Uint8ClampedArray();
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: (image: { data: Uint8ClampedArray }) => (pixels = image.data),
  };
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => context }) } });
  t.after(() => Reflect.deleteProperty(globalThis, 'document'));
  const texture = { canvas: () => createHash('sha256').update(pixels).digest('hex') };
  const painted = { texture } as unknown as Pick<typeof engine, 'texture'>;
  assert.equal(pixels.length, 0);
  assert.equal(leafTexture(painted), PAINTED.leaf);
  assert.equal(pixels.length, 256 * 256 * 4);
  for (const [name, look] of Object.entries(LOOKS))
    assert.equal(matcapBall({ ...painted, math: engine.math }, look), PAINTED[name as 'chrome']);
});

test('the robot is its named joints, and plays its three clips at once', () => {
  const { robot, paint, actions } = walkingRobot(engine);
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
});

test('the fleet parks three vehicles on the ground, shaped as they are drawn, the camera behind', async () => {
  const added: unknown[] = [],
    simulated: unknown[] = [];
  const camera = new Camera('perspective');
  const world = {
    camera,
    raycast: async () => ({ point: { y: 2 } }),
    scene: { add: (body: unknown) => added.push(body) },
    physics: { add: (driver: unknown) => simulated.push(driver) },
  };
  const { vehicles, chase } = await fleet(world as never, engine);
  const { car, motorcycle, tracked } = vehicles;
  assert.deepEqual(added, [car.body, motorcycle.body, tracked.body]);
  assert.deepEqual(simulated, [car.driver, motorcycle.driver, tracked.driver]);
  const parts = ({ physics }: typeof car.body) =>
    physics?.shape?.type === 'compound' ? physics.shape.parts.map(({ type }) => type) : [];
  assert.deepEqual(
    Object.values(vehicles).map((entry) => [
      entry.driver.kind,
      entry.wheels.length,
      parts(entry.body).join(' '),
    ]),
    [
      ['car', 4, 'box box box box box box box'],
      ['motorcycle', 2, 'box box box box sphere box'],
      ['tracked', 12, 'box box cylinder box box'],
    ],
  );
  // Each rests a little above the ground on its wheels, at its start, level and facing -z.
  const rounded = (vector: { toArray(): number[] }) =>
    vector.toArray().map((value) => Math.round(value * 100) / 100);
  assert.deepEqual(rounded(car.body.position), [0, 2.83, 20]);
  assert.equal(car.body.physics?.mass, 1470);
  assert.deepEqual(tracked.body.quaternion.toArray(), [0, 0, 0, 1]);
  chase(car, 1e9);
  assert.deepEqual(rounded(camera.position), [0, 5.23, 27.5]);
});

test('the four pages build their pieces with the kit and keep no copy', () => {
  const page = (name: string) =>
    readFileSync(new URL(`../site/examples/${name}.html`, import.meta.url), 'utf8');
  for (const [name, piece, copy] of [
    ['drive-a-car', 'fleet', 'hulls'],
    ['a-robot-that-walks-and-waves', 'walkingRobot', 'animation.clip('],
    ['leaves-cut-by-alpha', 'leafTexture', 'createImageData'],
    ['a-matcap-sculpture', 'matcapBall', 'createImageData'],
  ]) {
    const source = page(name);
    assert.match(source, new RegExp(`import \\{[^}]*\\b${piece}\\b[^}]*\\} from '../runtime/kit.js'`));
    assert.ok(!source.includes(copy), `${name} keeps no copy of ${piece}`);
  }
});
