import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { block } from './character.fixture.ts';

// Reference recovery poses after public feet coordinates are displaced into a
// corner. Millimetre tolerances avoid locking floating-point noise.
for (const example of [
  {
    radius: 1,
    height: 0.7,
    step: 0.3,
    x: 0.5,
    y: -0.1,
    speed: 0,
    expected: [0.014, 0, 0, 0, 0, 0],
  },
  {
    radius: 0.5,
    height: 0.6,
    step: 0.51,
    x: 0.9,
    y: -0.01,
    speed: 3.5,
    expected: [0.288, 0, 0, 0.13, 0, 0],
  },
])
  test(`recovering a floor/ledge overlap with walking speed ${example.speed}`, () => {
    const body = createCharacterBody({
      ...HUMAN_BODY,
      capsuleRadius: example.radius,
      capsuleHeight: 2,
      stepHeight: example.step,
      walkSpeed: example.speed,
    });
    const world = meshCollision([
      block(-20, -1, -20, 20, 0, 20),
      block(1, 0, -5, 3, example.height, 5),
    ]);
    body.setWorld(world);
    body.place(0, 0, 0);
    body.feet.set([example.x, example.y, 0]);
    for (let frame = 0; frame < 3; frame++)
      body.advance(1 / 120, { wishX: 1, wishZ: 0, sprint: false });
    [...body.feet, ...body.velocity].forEach((value, axis) =>
      assert.ok(Math.abs(value - example.expected[axis]) < 0.001),
    );
    assert.equal(body.onGround, true);
    assert.ok(Math.abs(body.feet[1]) < 1e-10);
    world.resolveCapsule({ feet: body.feet, radius: example.radius, height: 2 }, (touch) => {
      assert.ok(touch.depth < 0.001, 'recovery must leave no millimetre of penetration');
    });
  });

test('a fast displaced body recovers against an overhead corner with steps disabled', () => {
  const body = createCharacterBody({
    ...HUMAN_BODY,
    capsuleRadius: 1,
    capsuleHeight: 2,
    stepHeight: 0,
  });
  const overhead = block(3, 2, 0, 3.3, 3, 0.3);
  overhead.rotation.y = 1;
  const world = meshCollision([block(-20, -1, -20, 20, 0, 20), block(1, 0, -1, 3, 1, 1), overhead]);
  body.setWorld(world);
  body.place(0, 0, 0);
  body.feet.set([2, 0, 0]);
  body.velocity[0] = 90;
  body.advance(1 / 120, { wishX: 1, wishZ: 0, sprint: false });
  // Recorded recovery reference, rounded to millimetres. An overlap is an escape,
  // not permission to retry the stride through the disabled stepping path.
  const expected = [1.9635, 1, -0.00756, 0, 0, 0];
  [...body.feet, ...body.velocity].forEach((value, axis) =>
    assert.ok(Math.abs(value - expected[axis]) < 0.001),
  );
  world.resolveCapsule({ feet: body.feet, radius: 1, height: 2 }, (touch) => {
    assert.ok(touch.depth < 0.001, 'the recovery ends outside the solids');
  });
});
