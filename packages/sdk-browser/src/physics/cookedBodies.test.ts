import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADD_WORDS,
  BODY_INDEX,
  FLAG,
  MOTION,
  OP,
  POSE_WORDS,
  RESTORE_WORDS,
  SHAPE,
  type CookedBody,
} from '../../../sdk-core/src/physics/index.ts';
import { createCookedBodies } from './cookedBodies.ts';
import { body, castDown, startModule, type Module } from './module.fixture.ts';
import {
  cooked,
  landed,
  modelStreamer,
  place,
  stubFetch,
  streamedModel,
  tile,
} from './tiles.fixture.ts';

const fixture = (name: string) =>
  readFile(new URL(`../../../../tests/fixtures/physics/${name}`, import.meta.url));
/** The golden hull of a unit cube from the origin (`physics_cook/mass_tests.rs`). */
const hull = async () => new Uint8Array(await fixture('cube-hull.bin'));
const diagonal = (d: number) => [d, 0, 0, 0, d, 0, 0, 0, d];
/** Node `node`'s body at `position`, declaring `motion` and `shape`. */
const declared = (node: number, position: number[], motion: object, shape: object) =>
  ({ node, motion, shape, position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }) as CookedBody;
/** A shapeless body's cooked hull, weighed as the unit cube but about `centre`. */
const cube = (centre = [0.5, 0.5, 0.5]) => ({
  ...{ type: 'cooked', url: 'hull.bin', sha256: 'h'.repeat(64), bytes: 1 },
  mass: { mass: 1000, centerOfMass: centre, inertia: diagonal(1000 / 6) },
});
/** The ADD records among `words` — ADDs, RESTOREs and RELEASEs —: each one's words and floats. */
function adds(words: Uint32Array) {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length);
  const found: { w: Uint32Array; f: Float32Array }[] = [];
  for (let at = 0; at < words.length;) {
    const op = words[at];
    if (op === OP.add) {
      found.push({ w: words.subarray(at), f: f.subarray(at) });
      at += ADD_WORDS + words[at + 23] * 3 + words[at + 24];
    } else at += op === OP.restore ? RESTORE_WORDS + Math.ceil(words[at + 2] / 4) : 2;
  }
  return found;
}
/** Where a cooked body's mass frame starts in its ADD: past its handle. */
const FRAME = ADD_WORDS + 1;
/** Steps `jolt` for `seconds` at 60 Hz: each body's last pose, by slot. */
function run(jolt: Module, seconds: number) {
  const last = new Map<number, Float32Array>();
  for (let s = 0; s < seconds * 60; s++) {
    const posed = jolt.poses(jolt.step(null, 1 / 60));
    for (let at = 0; at < posed.length; at += POSE_WORDS)
      last.set(posed[at] & BODY_INDEX, new Float32Array(posed.slice(at + 1, at + 8).buffer));
  }
  return last;
}

test('a declared dynamic box is held kinematic at its drawn pose, its node’s tile left out', async () => {
  const box = declared(0, [0, 2, 0], { mass: 5 }, { type: 'box', box: { size: [2, 1, 1] } });
  const collider = { tiles: [tile()], material: null };
  const file = { ...cooked([collider, collider], [place(0), place(1)]), bodies: [box] };
  const ramp = await fixture('ramp-tile.bin');
  const { tiles, writer, bodies, errors } = await streamedModel(file, ramp);
  tiles.update([0, 0, 0], 1000);
  await landed();
  const words = writer.take();
  const [held, ground, ...more] = adds(words);
  assert.deepEqual([errors, more], [[], []]);
  const [kind, flags] = [[held.w[2], held.w[4]], held.w[5]];
  assert.deepEqual([kind, flags], [[MOTION.kinematic, SHAPE.box], FLAG.asleep], 'held, asleep');
  assert.deepEqual(
    [...held.f.subarray(6, 9), ...held.f.subarray(13, 17)],
    [0, 2, 0, 1, 0.5, 0.5, 5],
  );
  assert.deepEqual([ground.w[4], ground.f[6]], [SHAPE.cooked, 10], 'only node 1’s tile is ground');
  assert.equal(bodies.count.bodies, 2, 'no collider doubled');
  const jolt = await startModule();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(60, MOTION.dynamic, 4, 0.25), position: [0.5, 4, 0] });
  jolt.step(writer.take(), 0);
  jolt.step(words, 0);
  const rest = run(jolt, 2);
  assert.ok(Math.abs(rest.get(60)![1] - 2.75) < 0.02, `a crate rests on it: ${rest.get(60)![1]}`);
  assert.equal(castDown(jolt, -0.5)[0], held.w[1], 'a ray meets the body, where it is drawn');
});

test('a shapeless node restores its cooked hull and mass, and turns about the cooked centre of mass', async () => {
  const bytes = await hull();
  const upright = declared(0, [0, 0, -2], {}, cube());
  const tipped = declared(1, [0, 0, 2], {}, cube([0.9, 0.5, 0.5]));
  // Its inertia provided a thousand times the cooked one's: the same fall barely turns it.
  const stiff = declared(2, [0, 0, 5], { inertiaDiagonal: [2e5, 2e5, 2e5] }, tipped.shape);
  const fetched = stubFetch(cooked([], []), bytes);
  const { model, writer, bodies } = modelStreamer();
  const released = createCookedBodies(writer, bodies, () => {}, assert.fail, true);
  released.open(model, [upright, tipped, stiff], new AbortController().signal);
  await landed();
  const words = writer.take();
  const [a, b, c] = adds(words);
  assert.deepEqual([b.w[2], b.w[4], b.f[16], b.w[24]], [MOTION.dynamic, SHAPE.cooked, 1000, 13]);
  assert.deepEqual(
    [...b.f.subarray(FRAME, FRAME + 3)],
    [0.9, 0.5, 0.5].map(Math.fround),
    'its centre of mass',
  );
  assert.ok(Math.abs(b.f[FRAME + 3] - 1000 / 6) < 1e-3, 'its inertia, as cooked');
  assert.equal(fetched.filter((f) => f === 'hull.bin').length, 1, 'one read, never built');
  const jolt = await startModule();
  writer.gravity([0, -9.81, 0]);
  // A ledge whose edge, at x = 0.6, holds the hull's own centre and not the cooked one.
  writer.add({
    ...body(60, MOTION.static, -0.5, 1),
    position: [-0.7, -0.5, 0],
    size: [1.3, 0.5, 8],
  });
  jolt.step(writer.take(), 0);
  jolt.step(words, 0);
  const last = run(jolt, 1);
  assert.ok(
    Math.abs(last.get(a.w[1] & BODY_INDEX)?.[6] ?? 1) > 0.999,
    'about its centre, it stays',
  );
  const turn = (made: { w: Uint32Array }) => Math.abs(last.get(made.w[1] & BODY_INDEX)![6]);
  assert.ok(turn(b) < 0.95, `about the cooked centre, it tips: ${turn(b)}`);
  assert.ok(turn(c) > 0.995, `the provided inertia holds it: ${turn(c)}`);
});

test('a declared mass and centre win over the cooked ones; a model scaled weighs the solid scaled', async () => {
  const motion = { mass: 5, centerOfMass: [0.2, 0.3, 0.4] };
  const own = await streamedModel(
    { ...cooked([], []), bodies: [declared(0, [0, 0, 0], motion, cube())] },
    await hull(),
  );
  const [won] = adds(own.writer.take());
  assert.deepEqual([won.w[2], won.f[16]], [MOTION.kinematic, 5], 'held, at its declared mass');
  assert.deepEqual([...won.f.subarray(FRAME, FRAME + 3)], [0.2, 0.3, 0.4].map(Math.fround));
  assert.ok(Math.abs(won.f[FRAME + 3] - 5 / 6) < 1e-5, 'the cooked inertia, to the declared mass');
  const file = { ...cooked([], []), bodies: [declared(0, [0, 0, 0], {}, cube())] };
  const [scaled] = adds((await streamedModel(file, await hull(), {}, 2)).writer.take());
  assert.deepEqual(
    [...scaled.f.subarray(13, 17)],
    [2, 2, 2, 8000],
    'the hull and its mass, scaled',
  );
  assert.deepEqual([...scaled.f.subarray(FRAME, FRAME + 3)], [1, 1, 1]);
  assert.ok(Math.abs(scaled.f[FRAME + 3] - 16000 / 3) < 1e-2, `inertia ${scaled.f[FRAME + 3]}`);
});

test('a declared kinematic body follows its model; refusals are named; a removed model gives its slots back', async () => {
  const kinematic = declared(0, [0, 1, 0], { isKinematic: true }, { type: 'sphere' });
  const tapered = { type: 'capsule', capsule: { radiusTop: 0.2 } };
  const box = declared(2, [0, 0, 0], {}, { type: 'box' });
  const file = { ...cooked([], []), bodies: [kinematic, declared(1, [0, 0, 0], {}, tapered), box] };
  const streamed = await streamedModel(file, new Uint8Array(4), { bodies: 1 });
  const { tiles, scene, model, writer, bodies, errors } = streamed;
  assert.deepEqual(errors.map((e) => e.code).sort(), ['PHYSICS_BUDGET', 'PHYSICS_FAILED']);
  const named = (errors as unknown as Error[]).map((e) => e.message).join();
  assert.match(named, /node 1 declares a capsule/);
  const [made] = adds(writer.take());
  const id = made.w[1];
  model.position.set(1, 0, 0);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  const moved = writer.take();
  assert.deepEqual(
    [moved[0], moved[1], ...new Float32Array(moved.buffer, 8, 3)],
    [OP.moveKinematic, id & BODY_INDEX, 1, 1, 0],
  );
  assert.equal(tiles.modelOf(id), model, 'a ray on it names its model');
  model.scale.set(2, 2, 2);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  const again = adds(writer.take()).map(({ f }) => f[13]);
  assert.deepEqual(again, [1], 'rescaled, made again in the same frame');
  scene.remove(model);
  tiles.scan(scene);
  assert.deepEqual([...writer.take()], [OP.remove, id & BODY_INDEX]);
  assert.deepEqual([bodies.count.bodies, tiles.modelOf(id)], [0, null], 'its slot given back');
});
