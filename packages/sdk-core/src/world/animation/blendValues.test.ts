import assert from 'node:assert/strict';
import test from 'node:test';
import { Blend, Blends } from './blend.ts';

const close = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-12, `${actual} differs from ${expected}`),
  );

test('one property shares a blend across targets while arrays preserve untracked values and their identity', () => {
  const owner = { weights: [4, 8, 12, 99], other: 10 };
  const held = owner.weights;
  const blends = new Blends();
  const target = { owner, field: 'weights', value: [0, 0, 0] };
  const blend = blends.of(target, false);
  assert.equal(blends.of(target, false), blend);
  assert.equal(blends.of({ ...target }, false), blend);
  assert.notEqual(blends.of({ owner, field: 'other', value: [0] }, false), blend);
  assert.notEqual(blends.of({ ...target, owner: { weights: [1, 2, 3] } }, false), blend);
  blends.add(blend, [8, 12, 16], 0.5);
  blends.write();
  assert.equal(owner.weights, held);
  assert.deepEqual(held, [6, 10, 14, 99]);
  blends.add(blend, [6, 9, 12], 2);
  blends.add(blend, [0, 3, 6], 1);
  blends.write();
  assert.deepEqual(held, [4, 7, 10, 99]);
  held[0] = 100;
  blends.write();
  assert.equal(held[0], 100, 'idle frames do not rewrite properties');
  target.field = 'other';
  blends.add(blends.of(target, false), [1, 2, 3], 1);
  blends.write();
  assert.deepEqual(owner.weights, [1, 2, 3, 99], 'a target remains bound on first use');
  assert.equal(owner.other, 10);
});

test('colour rest channels and additive numbers reset for each touched frame', () => {
  const colour = {
    r: 0.2,
    g: 0.4,
    b: 0.6,
    setRGB(r: number, g: number, b: number) {
      Object.assign(this, { r, g, b });
    },
  };
  const owner = { colour, opacity: 8 };
  const blends = new Blends();
  const rgb = blends.of({ owner, field: 'colour', value: [0, 0, 0] }, false);
  const opacity = blends.of({ owner, field: 'opacity', value: [0] }, false);
  blends.add(rgb, [1, 0.8, 0.2], 0.5);
  blends.addDifference(opacity, [4], 0.5);
  blends.addDifference(opacity, [100], -2);
  blends.write();
  close([colour.r, colour.g, colour.b], [0.6, 0.6, 0.4]);
  assert.equal(owner.opacity, 10);
  blends.addDifference(opacity, [2], 1);
  blends.write();
  assert.equal(owner.opacity, 10, 'the previous additive frame must not accumulate');
  blends.add(opacity, [100], -1);
  blends.write();
  assert.equal(owner.opacity, 8);
});

test('additive rotations compose partial turns, respect hemispheres and reset their identity', () => {
  const owner = { rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  const blends = new Blends();
  const blend = blends.of({ owner, field: 'rotation', value: [0, 0, 0, 1] }, true);
  blends.addDifference(blend, [0, 0, 1, 0], 0.5);
  blends.write();
  close(owner.rotation, [0.5, 0.5, 0.5, 0.5]);
  blends.add(blend, [0, 0, 0, 1], 1);
  blends.addDifference(blend, [0, 0, -Math.SQRT1_2, -Math.SQRT1_2], 0.5);
  blends.write();
  close(owner.rotation, [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]);
  blends.add(blend, [0, 0, 0, 1], 1);
  blends.addDifference(blend, [Math.SQRT1_2, 0, 0, Math.SQRT1_2], 1);
  blends.addDifference(blend, [0, 0, Math.SQRT1_2, Math.SQRT1_2], 1);
  blends.write();
  close(owner.rotation, [0.5, -0.5, 0.5, 0.5]);
  blends.add(blend, [0, 0, 0, 1], 1);
  blends.write();
  close(owner.rotation, [0, 0, 0, 1]);
});

test('plain vector values without setters remain readable without throwing on write', () => {
  const owner = { vector: { x: 1, y: 2, z: 3 } };
  const blends = new Blends();
  const blend = blends.of({ owner, field: 'vector', value: [0, 0, 0] }, false);
  blends.add(blend, [9, 9, 9], 1);
  assert.doesNotThrow(() => blends.write());
  assert.deepEqual(owner.vector, { x: 1, y: 2, z: 3 });
});

test('many additive quarter turns retain their rotation without losing numeric scale', () => {
  const owner = { rotation: [0, 0, 0, 1] };
  const blends = new Blends();
  const blend = blends.of({ owner, field: 'rotation', value: [0, 0, 0, 1] }, true);
  // 1101 quarter turns are 275 whole turns followed by one quarter turn.
  for (let i = 0; i < 1101; i++) blends.addDifference(blend, [0, 0, 1, 0], 0.5);
  blends.write();
  assert.ok(Math.abs(Math.abs(owner.rotation[2]) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(owner.rotation[2] * owner.rotation[3] - 0.5) < 1e-12);
  close(owner.rotation.slice(0, 2), [0, 0]);
});

test('a newly bound rotation can publish its rest pose before any action touches it', () => {
  const owner = { rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  new Blend(owner, 'rotation', true, 4).write();
  close(owner.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
});

test('morph arrays wider than a quaternion blend signed values and preserve every additive channel', () => {
  const owner = { weights: [1, 2, 3, 4, 5] };
  const blends = new Blends();
  const blend = blends.of({ owner, field: 'weights', value: [0, 0, 0, 0, 0] }, false);
  blends.add(blend, [1, 2, 3, 4, 5], 1);
  blends.add(blend, [-1, -2, -3, -4, -5], 1);
  blends.write();
  assert.deepEqual(owner.weights, [0, 0, 0, 0, 0]);
  blends.addDifference(blend, [0, 0, 0, 0, 0], 1);
  blends.write();
  assert.deepEqual(owner.weights, [1, 2, 3, 4, 5]);
});
