import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import type { CharacterCollision } from './characterCollision.ts';
import { meshCollision } from './meshTriangles.ts';
import { block, EAST } from './character.fixture.ts';

/** The deepest overlap of a capsule standing on `feet` with `world`, metres. */
function deepest(world: CharacterCollision, feet: Float64Array, radius: number, height: number) {
  let depth = 0;
  world.resolveCapsule({ feet: Float64Array.from(feet), radius, height }, (touch) => {
    depth = Math.max(depth, touch.depth);
  });
  return depth;
}

for (const { radius, ledge, step, x, y, speed } of [
  { radius: 1, ledge: 0.7, step: 0.3, x: 0.5, y: -0.1, speed: 0 },
  { radius: 0.5, ledge: 0.6, step: 0.51, x: 0.9, y: -0.01, speed: 3.5 },
])
  test(`feet pushed into a floor and a ledge too high to climb come out on the floor, walking at ${speed} m/s`, () => {
    const body = createCharacterBody({
      ...HUMAN_BODY,
      capsuleRadius: radius,
      capsuleHeight: 2,
      stepHeight: step,
      walkSpeed: speed,
    });
    const world = meshCollision([block(-20, -1, -20, 20, 0, 20), block(1, 0, -5, 3, ledge, 5)]);
    body.setWorld(world);
    body.place(0, 0, 0);
    body.feet.set([x, y, 0]);
    for (let frame = 0; frame < 3; frame++) body.advance(1 / 120, EAST);
    assert.equal(body.onGround, true);
    assert.ok(Math.abs(body.feet[1]) < 1e-10, `feet at ${body.feet[1]}`);
    assert.ok(body.feet[0] < 1, 'the ledge is not climbed');
    assert.ok(deepest(world, body.feet, radius, 2) < 1e-3, 'no millimetre left inside');
  });

test('a fast body pushed into a block, steps disabled, escapes without taking its stride', () => {
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
  body.advance(1 / 120, EAST);
  // At 90 m/s a tick's stride is 0.75 m: an overlap is an escape, never a retry of the stride.
  assert.ok(body.feet[0] - 2 < 90 / 120 / 2, `carried to ${body.feet[0]}`);
  assert.ok(deepest(world, body.feet, 1, 2) < 1e-3, 'the escape ends outside the solids');
});

test('a body pushed into a tilted crate comes out on the side it came from', () => {
  // A crate turned 41° about z, its side face leaning over the body pushed 6 cm into it: the way
  // out is back west, never through the crate.
  const crate = block(1, 0, -3, 1.82, 0.864, 3);
  crate.rotation.z = 0.72;
  const world = meshCollision([block(-20, -1, -20, 20, 0, 20), crate]);
  const body = createCharacterBody({ ...HUMAN_BODY });
  body.setWorld(world);
  body.place(0, 0, 0);
  body.feet.set([1 - HUMAN_BODY.capsuleRadius + 0.058, -0.014, 0]);
  body.advance(1 / 120, EAST);
  assert.ok(body.feet[0] < 1, `pushed to ${body.feet[0]}`);
  assert.ok(deepest(world, body.feet, HUMAN_BODY.capsuleRadius, HUMAN_BODY.capsuleHeight) < 1e-3);
});

// Walks into corners of a ledge, a wall and a roof, each a few centimetres from the next.
for (const route of [
  {
    name: 'climbing beside an overhead corner',
    step: 1,
    radius: 0.4,
    ledge: 1,
    width: 0.4,
    start: [0.6, 0, -1.16],
    wall: [1.17, -0.9, 0.3],
    roof: [1.3, 3],
    speed: 10,
    angle: 1,
  },
  {
    name: 'turning beside a covered ledge',
    step: 1,
    radius: 0.4,
    ledge: 0.5,
    width: 2,
    start: [0.6, 0, 0],
    wall: [1.1, -0.5, 1],
    roof: [0.6, 2.8],
    speed: 9.7,
    angle: -1,
  },
  {
    name: 'leaving a short platform beside a wall',
    step: 0.7,
    radius: 0.2,
    ledge: 0.4,
    width: 0.4,
    start: [1, 0.4, 0],
    wall: [1, 1, 1],
    roof: [1.6, 2.7],
    speed: 9,
    angle: 1,
  },
  {
    name: 'sliding along the front of a narrow ledge',
    step: 1,
    radius: 0.4,
    ledge: 0.464,
    width: 0.3,
    start: [0.54, 0, 0.8],
    wall: [1, 0, 0.5],
    roof: null,
    speed: 9,
    angle: 0.03,
  },
])
  test(`${route.name}: no tunnelling, no gain of speed, no height out of the scene`, () => {
    const settings = { ...HUMAN_BODY, capsuleRadius: route.radius, stepHeight: route.step };
    const body = createCharacterBody(settings);
    const [wallX, wallZ, wallWidth] = route.wall;
    const meshes = [
      block(-20, -1, -20, 20, 0, 20),
      block(1, 0, -1, 1 + route.width, route.ledge, 1),
      block(wallX, 0, wallZ, wallX + wallWidth, 3, wallZ + 0.1),
    ];
    if (route.roof) meshes.push(block(route.roof[0], route.roof[1], -5, 10, route.roof[1] + 1, 5));
    const world = meshCollision(meshes);
    body.setWorld(world);
    body.place(route.start[0], route.start[1], route.start[2]);
    const input = { wishX: Math.cos(route.angle), wishZ: Math.sin(route.angle), sprint: false };
    body.velocity.set([input.wishX * route.speed, 0, input.wishZ * route.speed]);
    for (let frame = 0; frame < 20; frame++) {
      const before = [...body.feet];
      body.advance(1 / 120, input);
      const moved = Math.hypot(body.feet[0] - before[0], body.feet[2] - before[2]);
      assert.ok(moved < route.radius, `moved ${moved} in a frame`);
      assert.ok(body.feet[1] >= -1e-6 && body.feet[1] <= route.ledge + 1e-6, `${body.feet[1]}`);
      assert.ok(Math.hypot(...body.velocity) <= route.speed + 1e-9, 'a corner adds no speed');
    }
    assert.equal(body.onGround, true);
    const depth = deepest(world, body.feet, settings.capsuleRadius, settings.capsuleHeight);
    assert.ok(depth < 1e-3, `ends ${depth} m inside`);
  });
