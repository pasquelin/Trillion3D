import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { block } from './character.fixture.ts';

const floor = () => block(-50, -1, -50, 50, 0, 50);
const close = (actual: ArrayLike<number>, expected: ArrayLike<number>) =>
  Array.from(actual).forEach((value, k) => assert.ok(Math.abs(value - expected[k]) < 1e-10));

test('a rejected raised step cannot steal sliding velocity through an otherwise clear passage', () => {
  const run = (beam: boolean) => {
    const body = createCharacterBody({ ...HUMAN_BODY });
    const meshes = [floor(), block(1, 0, -50, 1.2, 10, 50)];
    if (beam) meshes.push(block(-5, 1.9, 0.1, 5, 3, 5));
    body.setWorld(meshCollision(meshes));
    body.place(1 - HUMAN_BODY.capsuleRadius, 0, -0.05);
    body.velocity.set([1, 0, 1]);
    body.advance(1 / 120, { wishX: Math.SQRT1_2, wishZ: Math.SQRT1_2, sprint: false });
    return body;
  };
  const clear = run(false),
    belowBeam = run(true);
  assert.ok(clear.velocity[2] > 1);
  // The beam is above the real capsule. Only a discarded speculative step touches it.
  close(belowBeam.feet, clear.feet);
  close(belowBeam.velocity, clear.velocity);
});

test('a speculative step cannot add horizontal travel before committing the shorter move', () => {
  for (const axis of [0, 2]) {
    const settings = { ...HUMAN_BODY, capsuleRadius: 0.5, capsuleHeight: 2, stepHeight: 0.6 };
    const ledge = axis === 0 ? block(1, 0, -5, 10, 0.55, 5) : block(-5, 0, 1, 5, 0.55, 10);
    const collision = meshCollision([floor(), ledge]);
    const body = createCharacterBody(settings),
      flat = createCharacterBody(settings);
    body.setWorld(collision);
    flat.setWorld(meshCollision([floor()]));
    for (const made of [body, flat]) {
      made.place(axis === 0 ? 0.5 : 0, 0, axis === 2 ? 0.5 : 0);
      made.velocity[axis] = 3;
    }
    const input = { wishX: axis === 0 ? 1 : 0, wishZ: axis === 2 ? 1 : 0, sprint: false };
    body.advance(1 / 120, input);
    flat.advance(1 / 120, input);
    assert.ok(body.feet[1] > 0.1, 'the step is actually climbed');
    assert.ok(body.feet[axis] <= flat.feet[axis] + 1e-10, 'probing cannot add horizontal travel');
    assert.ok(body.feet[axis] > 0.5);
  }
});

test('disabling steps prevents even a ledge lower than the capsule radius from lifting a walker', () => {
  const body = createCharacterBody({ ...HUMAN_BODY, stepHeight: 0 });
  body.setWorld(meshCollision([floor(), block(1, 0, -5, 10, 0.1, 5)]));
  body.place(0.9, 0, 0);
  assert.ok(Math.abs(body.feet[1]) < 1e-12, 'settling against the edge stays on the floor');
  for (let tick = 0; tick < 60; tick++) {
    body.advance(1 / 120, { wishX: 1, wishZ: 0, sprint: false });
  }
  assert.ok(Math.abs(body.feet[1]) < 1e-8, 'the walker remains at floor height');
  assert.ok(body.feet[0] < 1, 'the ledge blocks horizontal travel');
});
