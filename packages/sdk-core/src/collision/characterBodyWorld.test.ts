import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { triangleCollision } from './characterCollision.ts';
import { meshCollision } from './meshTriangles.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { block } from './character.fixture.ts';

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

test('a teleport is drawn exactly where it lands, not between it and the last pose', () => {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.place(100.1, 0, 0);
  body.advance(1 / 120, still);
  body.place(0.1, 0, 0);
  assert.deepEqual([...body.advance(0, still)], [0.1, 0, 0]);
});

test('an airborne body loses normal velocity at a steep slope and slides along its tangent', () => {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(triangleCollision(buildTriangleTree([-6, -8, -6, 6, 8, -6, -6, -8, 6])));
  body.place(-1, -4 / 3, -2);
  assert.equal(body.onGround, false);
  body.advance(1 / 120, still);
  assert.equal(body.onGround, false);
  assert.ok(body.velocity[0] < 0);
  assert.ok(body.velocity[1] < 0);
  assert.ok(Math.abs(3 * body.velocity[1] - 4 * body.velocity[0]) < 1e-10);
  assert.equal(body.velocity[2], 0);
});

test('brushing a ledge during ascent preserves the jump and does not report an upward landing', () => {
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(meshCollision([block(-50, -1, -50, 50, 0, 50), block(1, 0, -5, 10, 0.5, 5)]));
  body.place(0.4, 0, 0);
  body.velocity[0] = 3;
  body.pressJump();
  const impacts: number[] = [];
  let apex = 0;
  for (let tick = 0; tick < 100; tick++) {
    body.advance(1 / 120, { ...still, wishX: 1 }, { onLand: (impact) => impacts.push(impact) });
    apex = Math.max(apex, body.feet[1]);
  }
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0] >= 0, 'landing happens while descending');
  assert.ok(apex > 0.55, 'a rising edge contact does not cancel the rest of the jump');
});

test('a horizontal contact can land with exactly zero vertical impact', () => {
  const body = createCharacterBody({
    ...HUMAN_BODY,
    capsuleRadius: 0.5,
    capsuleHeight: 2,
    gravity: 0,
    fallGravity: 0,
    airControl: 0,
  });
  body.setWorld(meshCollision([block(-20, -1, -20, 20, 0, 20), block(1, 0, -5, 3, 0.2, 5)]));
  body.place(0.69, 0.1, 0);
  assert.equal(body.onGround, false);
  body.velocity[0] = 3;
  const impacts: number[] = [];
  body.advance(1 / 120, { ...still, wishX: 1 }, { onLand: (impact) => impacts.push(impact) });
  assert.equal(body.onGround, true);
  assert.equal(impacts.length, 1);
  assert.ok(impacts[0] === 0);
  assert.ok(body.feet[1] > 0.1);
});
