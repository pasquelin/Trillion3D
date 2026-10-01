import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { block, EAST } from './character.fixture.ts';

test('a fast grounded walker cannot climb a sub-radius ledge when steps are disabled', () => {
  const body = createCharacterBody({ ...HUMAN_BODY, capsuleRadius: 0.3, stepHeight: 0 });
  body.setWorld(meshCollision([block(-20, -1, -20, 20, 0, 20), block(1, 0, -5, 2, 0.29, 5)]));
  body.place(0.7, 0, 0);
  body.velocity[0] = 14;
  for (let frame = 0; frame < 10; frame++) body.advance(1 / 120, EAST);
  assert.ok(Math.abs(body.feet[1]) < 1e-8);
  assert.ok(body.feet[0] < 1);
  assert.ok(Math.abs(body.velocity[0]) < 1e-8);
});

test('walking onto a low step does not launch a body into the air without a jump', () => {
  const base = 2.795;
  const body = createCharacterBody({ ...HUMAN_BODY, capsuleRadius: 0.1, stepHeight: 0.67 });
  body.setWorld(
    meshCollision([block(-20, base - 1, -20, 20, base, 20), block(1, base, -5, 2, base + 0.1, 5)]),
  );
  body.place(0.81, base, 0);
  body.velocity[0] = 7;
  for (let frame = 0; frame < 10; frame++) body.advance(1 / 120, EAST);
  assert.equal(body.onGround, true);
  assert.ok(body.feet[1] <= base + 0.1 + 1e-6, 'feet cannot float above every available floor');
});

test('vertical translation preserves grounding, velocity and the maximum climbable step', () => {
  for (const ledge of [0.25, 0.38]) {
    let reference: number[] | undefined;
    for (const base of [0, -4, -1, 1, 2, 4, 8]) {
      const body = createCharacterBody({ ...HUMAN_BODY, capsuleRadius: 0.31, stepHeight: 0.29 });
      body.setWorld(
        meshCollision([
          block(-20, base - 1, -20, 20, base, 20),
          block(1, base, -5, 3, base + ledge, 5),
        ]),
      );
      body.place(0.57, base, 0);
      assert.equal(body.onGround, true, 'feet placed on the floor are grounded at every elevation');
      body.velocity[0] = 8;
      for (let frame = 0; frame < 10; frame++) body.advance(1 / 120, EAST);
      const pose = [body.feet[0], body.feet[1] - base, body.feet[2], ...body.velocity];
      if (reference)
        pose.forEach((value, axis) => assert.ok(Math.abs(value - reference![axis]) < 1e-6));
      else reference = pose;
      assert.equal(body.onGround, true);
      if (ledge > 0.29) {
        assert.ok(body.feet[0] < 1, 'a ledge above stepHeight blocks forward travel');
        assert.ok(
          Math.abs(body.feet[1] - base) < 1e-8,
          'a failed actual step restores the floor pose',
        );
        assert.ok(
          Math.abs(body.velocity[0]) < 1e-8,
          'a failed actual step retains the stopped velocity',
        );
      } else {
        assert.ok(body.feet[0] > 1);
        assert.ok(Math.abs(body.feet[1] - base - ledge) < 1e-8);
      }
    }
  }
});

test('a ceiling above a walkable low ledge cannot slow a capsule that fits underneath', () => {
  const run = (ceiling: boolean) => {
    const body = createCharacterBody({
      ...HUMAN_BODY,
      capsuleRadius: 1,
      capsuleHeight: 2,
      stepHeight: 1,
    });
    const meshes = [block(-20, -1, -20, 20, 0, 20), block(1, 0, -5, 3, 0.3, 5)];
    if (ceiling) meshes.push(block(1, 2.4, -5, 10, 3.4, 5));
    body.setWorld(meshCollision(meshes));
    body.place(0, 0, 0);
    body.velocity[0] = 12;
    for (let frame = 0; frame < 10; frame++) body.advance(1 / 120, EAST);
    return [...body.feet, ...body.velocity];
  };
  const clear = run(false);
  const covered = run(true);
  assert.ok(clear[0] > 0.9 && clear[3] > 11);
  covered.forEach((value, axis) => assert.ok(Math.abs(value - clear[axis]) < 1e-8));
});

test('an unsuccessful climb beneath a ceiling cannot move a walker backwards', () => {
  // The ledge is under stepHeight, but the ceiling over it leaves no room for the body: the
  // raised move fails, and the walker keeps the pose it had against the ledge, or perches on
  // its lip.
  const body = createCharacterBody({ ...HUMAN_BODY, capsuleRadius: 0.4, stepHeight: 0.8 });
  body.setWorld(
    meshCollision([
      block(-20, 0, -20, 20, 1, 20),
      block(1, 1, -5, 2, 1.6, 5),
      block(0.8, 3.2, -5, 10, 4.2, 5),
    ]),
  );
  body.place(0.5, 1, 0);
  body.velocity[0] = 7;
  for (let frame = 0; frame < 10; frame++) {
    body.advance(1 / 120, EAST);
    assert.ok(body.feet[0] >= 0.5 - 1e-8, 'a discarded raised probe cannot push the body back');
  }
});
