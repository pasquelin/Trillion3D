import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_PHYSICS_BUDGET,
  JOLT_COMMIT,
  OP,
  SOFT_WORDS,
  type CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { createCookedSoftBodies } from './cookedSoft.ts';
import { startModule } from './module.fixture.ts';
import { addSoft, at, FLAT, settle, softWorld } from './soft.fixture.ts';
import { landed, streamedModel } from './tiles.fixture.ts';

/** The golden cooked cloth (`physics_cook/soft_tests.rs`): 1 m of 2 × 2 squares in the xy plane,
 *  its vertices row by row from (−0.5, −0.5), pinned at its top corners, bend 0.01 rad/(N·m). */
const golden = async () =>
  new Uint8Array(
    await readFile(
      new URL('../../../../tests/fixtures/physics/cloth-settings.bin', import.meta.url),
    ),
  );
const options = { type: 'cloth', pins: [6, 8], bend: 0.01 } as const;
/** Its `physics.json` entry, laid flat 2 m up, its settings `bytes` long; its collider's matter
 *  declared, its own friction too. */
const cookedCloth = (bytes: number): CookedSoftBody => ({
  ...{ node: 0, position: [0, 2, 0], rotation: FLAT, scale: [1, 1, 1] },
  ...{ physics: { ...options, friction: 0.2 }, vertices: 9, pressure: 0 },
  ...{ friction: 0.9, restitution: 0.3 },
  settings: { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes },
});
/** Its nine vertices, each its own: no two at one position. */
const own = { map: Uint32Array.from({ length: 9 }, (_, v) => v) };

test('a cooked cloth restores to the settings the page builds: laid flat, it swings the same', async () => {
  const built = await softWorld();
  addSoft(built, plane(1, 1, 2, 2), options, [0, 2, 0], { quaternion: FLAT });
  const restored = await softWorld();
  const record = { cooked: await golden(), pressure: 0 };
  addSoft(restored, plane(1, 1, 2, 2), options, [0, 2, 0], { quaternion: FLAT, record });
  const [a, b] = [settle(built, own, 1), settle(restored, own, 1)];
  assert.ok(Math.hypot(...at(b, 0).map((x, k) => x - [-0.5, -0.5, 0][k])) > 0.3, 'it swung');
  assert.ok(Math.hypot(...at(b, 6).map((x, k) => x - [-0.5, 0.5, 0][k])) < 1e-4, 'its pin held');
  for (let i = 0; i < a.length; i++)
    assert.ok(Math.abs(a[i] - b[i]) < 1e-5, `${i}: ${a[i]} ${b[i]}`);
});

/** A model at the origin, scaled by `scale`, whose `physics.json` carries the golden cloth laid
 *  flat 2 m up, streamed within `softVertices`: the words written, the bodies, the errors. */
async function opened(softVertices = DEFAULT_PHYSICS_BUDGET.softVertices, scale = 1) {
  const bytes = await golden();
  const file = {
    formatVersion: 2,
    jolt: JOLT_COMMIT,
    colliders: [],
    instances: [],
    softBodies: [cookedCloth(bytes.length)],
  };
  const opening = await streamedModel(file, bytes, { softVertices }, scale);
  return { ...opening, bytes };
}

test('a compiled model’s cooked cloth is made from its settings alone and moves from the first steps', async () => {
  const { scene, model, writer, bodies, tiles, errors, bytes } = await opened();
  const words = writer.take();
  assert.deepEqual(errors, []);
  assert.equal(words[0], OP.soft);
  assert.deepEqual([words[19], words[20], words[21]], [0, 0, bytes.length], 'no vertex, no corner');
  assert.deepEqual([...new Uint8Array(words.buffer, SOFT_WORDS * 4, bytes.length)], [...bytes]);
  const matter = [...new Float32Array(words.buffer, 12 * 4, 2)];
  assert.deepEqual(matter, [Math.fround(0.2), Math.fround(0.3)], 'its options over its collider');
  assert.equal(bodies.count.softVertices, 9, 'counted against the budget');
  const jolt = await startModule();
  writer.gravity([0, -9.81, 0]);
  jolt.step(writer.take(), 0);
  jolt.step(words, 0);
  const swung = settle(jolt, own, 0.25);
  assert.ok(Math.hypot(...at(swung, 0).map((x, k) => x - [-0.5, -0.5, 0][k])) > 0.05, 'it moves');
  assert.equal(tiles.modelOf(words[1]), model, 'a ray on it names its model');
  scene.remove(model);
  tiles.scan(scene);
  assert.equal(writer.take()[0], OP.remove, 'out with its model');
  assert.equal(bodies.count.softVertices, 0);
  assert.equal(tiles.modelOf(words[1]), null);
});

test('a model opened again before its settings arrive holds its cooked cloth once', async () => {
  const { model, writer, bodies } = await opened();
  writer.take();
  const softs = createCookedSoftBodies(writer, bodies, () => {}, assert.fail);
  softs.open(model, [cookedCloth(1)]);
  softs.open(model, [cookedCloth(1)]);
  await landed();
  assert.equal(bodies.count.softVertices, 9 + 9, 'the streamer’s cloth, and this opening’s once');
});

test('a model rescaled while its cooked cloth’s settings arrive has it refused by name', async () => {
  const { model, writer, bodies } = await opened();
  const errors: { code: string }[] = [];
  const softs = createCookedSoftBodies(
    writer,
    bodies,
    () => {},
    (e) => errors.push(e),
  );
  softs.open(model, [cookedCloth(1)]);
  model.scale.setScalar(2);
  model.updateMatrixWorld(true);
  await landed();
  assert.deepEqual(
    errors.map((e) => e.code),
    ['PHYSICS_FAILED'],
  );
  assert.equal(bodies.count.softVertices, 9, 'the streamer’s cloth alone');
});

test('a cooked soft body past the budget, or its model scaled from its cook, is refused by name', async () => {
  const over = await opened(8);
  assert.deepEqual(
    over.errors.map((e) => e.code),
    ['PHYSICS_BUDGET'],
  );
  assert.equal(over.writer.length, 0);
  const scaled = await opened(undefined, 2);
  assert.deepEqual(
    scaled.errors.map((e) => e.code),
    ['PHYSICS_FAILED'],
  );
  assert.equal(scaled.bodies.count.softVertices, 0);
});
