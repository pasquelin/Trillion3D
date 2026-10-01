import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY, type CharacterSettings } from './characterSettings.ts';
import type { CharacterCollision } from './characterCollision.ts';
import { meshCollision } from './meshTriangles.ts';
import { block, EAST, FLOOR } from './character.fixture.ts';

/** `world`, keeping every pose a capsule was asked about in `asked`. */
function watched(world: CharacterCollision, asked: number[][]): CharacterCollision {
  return {
    resolveCapsule: (capsule, push) => (
      asked.push([...capsule.feet]),
      world.resolveCapsule(capsule, push)
    ),
    groundBelow: (capsule, depth, accepts) => world.groundBelow(capsule, depth, accepts),
  };
}

/** Walks a body of `changes` over `blocks` for two seconds along `input`; the poses asked about. */
function walk(
  blocks: Parameters<typeof meshCollision>[0],
  changes: Partial<CharacterSettings>,
  input = EAST,
) {
  const asked: number[][] = [];
  const body = createCharacterBody({ ...HUMAN_BODY, ...changes });
  body.setWorld(watched(meshCollision(blocks), asked));
  body.place(0, 0, 0);
  asked.length = 0;
  for (let tick = 0; tick < 240; tick++) body.advance(1 / 120, input);
  return asked;
}

test('a walker no wall stops never lifts its capsule to look for a step', () => {
  const asked = walk([FLOOR()], {});
  assert.ok(asked.length > 0);
  for (const feet of asked) assert.ok(Math.abs(feet[1]) < 1e-9, `asked at ${feet}`);
});

test('a walker against a wall looks for a step a stepHeight up, unless stepHeight is 0', () => {
  const wall = block(1, 0, -5, 1.2, 3, 5);
  const top = (asked: number[][]) => Math.max(...asked.map((feet) => feet[1]));
  assert.ok(Math.abs(top(walk([FLOOR(), wall], {})) - HUMAN_BODY.stepHeight) < 1e-9);
  // With steps off, no foot is raised or put a radius ahead: nothing is asked further than a
  // tick's move past where the wall holds the body.
  const off = walk([FLOOR(), wall], { stepHeight: 0 });
  assert.ok(Math.abs(top(off)) < 1e-9);
  const tick = HUMAN_BODY.walkSpeed / 120;
  assert.ok(Math.max(...off.map((feet) => feet[0])) <= 1 - HUMAN_BODY.capsuleRadius + tick);
});

test("the foot put forward to look for a step goes along the walker's way", () => {
  // Walking slowly at 30° into a wall square to the walk: the raised foot goes forward along it.
  const turn = Math.PI / 6,
    input = { wishX: Math.cos(turn), wishZ: Math.sin(turn), sprint: false };
  const wall = block(1, 0, -5, 1.2, 3, 5);
  wall.rotation.y = -turn;
  const asked = walk([FLOOR(), wall], { walkSpeed: 0.5 }, input);
  const raised = asked.filter((feet) => Math.abs(feet[1] - HUMAN_BODY.stepHeight) < 1e-9);
  // The first raised pose is the raise's end, the next the first part of the foot's way ahead.
  assert.ok(raised.length > 1);
  const [dx, dz] = [raised[1][0] - raised[0][0], raised[1][2] - raised[0][2]];
  assert.ok(Math.abs(Math.atan2(dz, dx) - turn) < 1e-6, `probe turned ${Math.atan2(dz, dx)}`);
  // A radius ahead, not the tick's own few millimetres: walked in parts of half a radius.
  const first = Math.hypot(dx, dz);
  assert.ok(Math.abs(first - HUMAN_BODY.capsuleRadius / 2) < 1e-9, `first part ${first}`);
});
