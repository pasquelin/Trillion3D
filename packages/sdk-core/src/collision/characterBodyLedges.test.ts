import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { near } from '../math/near.fixture.ts';
import { block, EAST, STILL } from './character.fixture.ts';

const floor = () => block(-50, -1, -50, 50, 0, 50);

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
  near(belowBeam.feet, [...clear.feet], 'feet', 1e-10);
  near(belowBeam.velocity, [...clear.velocity], 'velocity', 1e-10);
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
    body.advance(1 / 120, EAST);
  }
  assert.ok(Math.abs(body.feet[1]) < 1e-8, 'the walker remains at floor height');
  assert.ok(body.feet[0] < 1, 'the ledge blocks horizontal travel');
});

test('a successful step keeps the incoming horizontal speed and a rejected step keeps the stopped pose', () => {
  for (const stepHeight of [0.2, 0.4]) {
    const body = createCharacterBody({ ...HUMAN_BODY, stepHeight });
    body.setWorld(meshCollision([block(-20, 2, -20, 20, 3, 20), block(1, 3, -10, 11, 3.3, 10)]));
    body.place(0.7, 3, 0);
    body.velocity[0] = 3.5;
    let climbed = false;
    for (let i = 0; i < 12; i++) {
      body.advance(1 / 120, EAST);
      if (body.feet[1] > 3 + 1e-6) {
        climbed = true;
        assert.ok(body.velocity[0] > 3.49);
        break;
      }
    }
    assert.equal(climbed, stepHeight === 0.4);
    if (!climbed) {
      assert.ok(Math.abs(body.feet[1] - 3) < 1e-12);
      assert.ok(Math.abs(body.velocity[0]) < 1e-12);
      assert.ok(body.feet[0] < 1);
    }
  }
});

test('elevated steps climb in both horizontal axes, while disabled steps keep feet on the floor', () => {
  for (const base of [-3, 3])
    for (const axis of [0, 2])
      for (const stepHeight of [0, 0.4]) {
        const ledge =
          axis === 0
            ? block(1, base, -10, 11, base + 0.3, 10)
            : block(-10, base, 1, 10, base + 0.3, 11);
        const body = createCharacterBody({ ...HUMAN_BODY, stepHeight });
        body.setWorld(meshCollision([block(-20, base - 1, -20, 20, base, 20), ledge]));
        body.place(0, base, 0);
        assert.equal(body.onGround, true, 'placing feet on an elevated floor grounds immediately');
        for (let i = 0; i < 120; i++)
          body.advance(1 / 60, {
            wishX: axis === 0 ? 1 : 0,
            wishZ: axis === 2 ? 1 : 0,
            sprint: false,
          });
        assert.equal(body.onGround, true);
        assert.ok(Math.abs(body.feet[1] - (base + (stepHeight ? 0.3 : 0))) < 1e-6);
        assert.ok(stepHeight ? body.feet[axis] > 3 : body.feet[axis] < 1);
        assert.ok(Math.abs(body.feet[axis === 0 ? 2 : 0]) < 1e-8);
      }
});
