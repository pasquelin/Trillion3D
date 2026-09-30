import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';

const still = { wishX: 0, wishZ: 0, sprint: false };

test('a worldless body moves in both horizontal axes, ignores jumps, and draws between ticks', () => {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.place(3, 7, -2);
  assert.equal(body.onGround, true);
  body.pressJump();
  let jumps = 0;
  const draw = [
    ...body.advance(
      1 / 240,
      { wishX: 0.6, wishZ: -0.8, sprint: false },
      {
        onJump: () => jumps++,
      },
    ),
  ];
  assert.ok(draw[0] > 3 && draw[0] < body.feet[0]);
  assert.ok(draw[2] < -2 && draw[2] > body.feet[2]);
  assert.ok(Math.abs(draw[0] - (3 + body.feet[0]) / 2) < 1e-12);
  assert.ok(Math.abs(draw[2] - (-2 + body.feet[2]) / 2) < 1e-12);
  assert.equal(draw[1], 7);
  assert.equal(jumps, 0);
  assert.deepEqual([...body.advance(0, still)], draw);
  body.place(-5, 11, 9);
  assert.deepEqual([...body.advance(0, still)], [-5, 11, 9]);
  assert.deepEqual([...body.velocity], [0, 0, 0]);
  body.advance(1 / 120, still);
  assert.deepEqual([...body.feet], [-5, 11, 9]);
});

test('world changes immediately settle the current position and update the live capsule size', () => {
  const settings = { ...HUMAN_BODY };
  const body = createCharacterBody(settings);
  body.place(3, 4, 5);
  let observed: number[] = [];
  const world = {
    resolveCapsule: (capsule: { radius: number; height: number }) => {
      observed = [capsule.radius, capsule.height];
      return false;
    },
    groundBelow: (capsule: { radius: number; height: number }) => {
      observed = [capsule.radius, capsule.height];
      return null;
    },
  };
  body.setWorld(world);
  assert.equal(body.onGround, false);
  assert.deepEqual(observed, [settings.capsuleRadius, settings.capsuleHeight]);
  settings.capsuleRadius = 0.8;
  settings.capsuleHeight = 3;
  body.place(7, 8, 9);
  assert.deepEqual(observed, [0.8, 3]);
  settings.capsuleRadius = 0.6;
  settings.capsuleHeight = 2.5;
  body.advance(1 / 60, still);
  assert.deepEqual(observed, [0.6, 2.5]);
  assert.ok(body.feet[1] < 8);
  body.setWorld(null);
  assert.equal(body.onGround, true);
  const y = body.feet[1];
  body.advance(1 / 60, still);
  assert.equal(body.feet[1], y);
});

test('elevated steps climb in both horizontal axes, while disabled steps keep feet on the floor', async () => {
  const { Mesh } = await import('../world/object/mesh.ts');
  const { box } = await import('../world/geometry/basic.ts');
  const { meshCollision } = await import('./meshTriangles.ts');
  for (const base of [-3, 3])
    for (const axis of [0, 2])
      for (const stepHeight of [0, 0.4]) {
        const floor = new Mesh(box(40, 1, 40));
        floor.position.set(0, base - 0.5, 0);
        const ledge = new Mesh(box(axis === 0 ? 10 : 20, 0.3, axis === 2 ? 10 : 20));
        ledge.position.set(axis === 0 ? 6 : 0, base + 0.15, axis === 2 ? 6 : 0);
        const body = createCharacterBody({ ...HUMAN_BODY, stepHeight });
        body.setWorld(meshCollision([floor, ledge]));
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

test('teleporting from large coordinates resets interpolation without cancellation', () => {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.place(1e16, 0, 0);
  body.advance(1 / 120, still);
  body.place(1, 0, 0);
  assert.deepEqual([...body.advance(0, still)], [1, 0, 0]);
});
