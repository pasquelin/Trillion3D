import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { block, EAST } from './character.fixture.ts';
import { deepestAt } from './characterScenes.fixture.ts';

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

test('a lip under stepHeight is not climbed when the slope above it is met higher than a step', () => {
  // A block tilted 57°: its upper corner overhangs the floor 0.48 m up, under stepHeight, and a
  // 33° face rises from it. Set down from a step's height, the foot meets that face 0.53 m up,
  // above the step: the first surface met refuses the step, as Unreal's StepUp and Jolt's stair
  // walk refuse theirs.
  const rock = block(1.808, 0.037, -3, 2.594, 0.52, 3);
  rock.rotation.z = -1;
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(meshCollision([block(-20, -1, -20, 20, 0, 20), rock]));
  body.place(0, 0, 0);
  for (let tick = 0; tick < 240; tick++) body.advance(1 / 120, EAST);
  assert.ok(Math.abs(body.feet[1]) < 1e-9, `feet at ${body.feet[1]}`);
  assert.ok(body.feet[0] < 1.8, `walked to ${body.feet[0]}`);
});

test('a walker up a ramp under a low ceiling stops where its head meets it, never inside', () => {
  // A 15° ramp from x = 1 under a ceiling 1.85 m up: the body fits on the ramp's first 0.1 m.
  const ramp = block(1, -1, -3, 9, 0, 3);
  ramp.rotation.z = Math.PI / 12;
  ramp.position.set(
    1 + 4 * Math.cos(Math.PI / 12) + 0.5 * Math.sin(Math.PI / 12),
    4 * Math.sin(Math.PI / 12) - 0.5 * Math.cos(Math.PI / 12),
    0,
  );
  const world = meshCollision([
    block(-20, -1, -20, 20, 0, 20),
    ramp,
    block(-2, 1.85, -3, 9, 2.5, 3),
  ]);
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(world);
  body.place(0, 0, 0);
  let inside = 0;
  for (let tick = 0; tick < 240; tick++) {
    body.advance(1 / 120, EAST);
    const depth = deepestAt(world, body.feet, HUMAN_BODY.capsuleRadius, HUMAN_BODY.capsuleHeight);
    inside = Math.max(inside, depth);
  }
  assert.ok(inside < 1e-3, `${inside} m inside`);
  assert.ok(body.feet[1] <= 1.85 - HUMAN_BODY.capsuleHeight + 1e-3, `feet at ${body.feet[1]}`);
  assert.ok(Math.abs(body.velocity[0]) < 0.5, `still pushing at ${body.velocity[0]} m/s`);
});

test('a walker stopped by a shelf at knee height stands on the floor under it', () => {
  // The shelf's underside, 0.46 m up, is under a step; its top, 1 m up, is not: the walker stays
  // on its floor against the shelf's front, never perched in the air beside it.
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(meshCollision([block(-20, -1, -20, 20, 0, 20), block(0.52, 0.46, -3, 1.97, 1, 3)]));
  body.place(0, 0, 0);
  for (let tick = 0; tick < 240; tick++) body.advance(1 / 120, EAST);
  assert.ok(Math.abs(body.feet[1]) < 1e-9, `feet at ${body.feet[1]}`);
  assert.ok(body.feet[0] < 0.52, `walked to ${body.feet[0]}`);
});

test("a wedge's raised end, an overhang lower than a step, is not stood on", () => {
  // A slab tilted 28° about z rests its east end on the floor; its west end overhangs 0.41 m up
  // and its top edge there is 0.57 m up, above a step: the walker stops on the floor against it.
  const wedge = block(2.03, 0, -3, 3.727, 0.186, 3);
  wedge.rotation.z = -0.484;
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(meshCollision([block(-20, -1, -20, 20, 0, 20), wedge]));
  body.place(0, 0, 0);
  for (let tick = 0; tick < 240; tick++) body.advance(1 / 120, EAST);
  assert.ok(Math.abs(body.feet[1]) < 1e-9, `feet at ${body.feet[1]}`);
});
