import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { meshCollision } from './meshTriangles.ts';
import { block, rebase } from './character.fixture.ts';

// Recorded public trajectories, rounded to millimetres and mm/s. These protect
// controller behavior around corners; they are not an analytic physics oracle.
const routes = [
  {
    name: 'climbing beside an overhead corner while staying grounded',
    radius: 0.4,
    step: 1,
    ledge: 1,
    width: 0.4,
    start: [0.6, 0, -1.16],
    wall: [1.17, -0.9, 0.3],
    roof: [1.3, 3],
    speed: 10,
    angle: 1,
    expected: [0.791, 0.941, 0.145, 0.333, 0, 7.221],
  },
  {
    name: 'turning beside a covered ledge',
    coordinates: [
      { scale: 1, offsetX: 0, originY: 0 },
      { scale: 1e34, offsetX: 4e37, originY: 0 },
    ],
    radius: 0.4,
    step: 1,
    ledge: 0.5,
    width: 2,
    start: [0.6, 0, 0],
    wall: [1.1, -0.5, 1],
    roof: [0.6, 2.8],
    speed: 9.7,
    angle: -1,
    expected: [0.508, 0, -0.776, -1.168, 0, -3.818],
  },
  {
    name: 'leaving a short platform beside a wall',
    radius: 0.2,
    step: 0.7,
    ledge: 0.4,
    width: 0.4,
    start: [1, 0.4, 0],
    wall: [1, 1, 1],
    roof: [1.6, 2.7],
    speed: 9,
    angle: 1,
    expected: [1.751, 0, 0.8, 4.128, 0, 0],
  },
  {
    name: 'sliding along the front of a narrow ledge',
    // Rebased geometry keeps local mesh precision at a large world origin.
    coordinates: [
      { scale: 1, offsetX: 0, originY: 0 },
      { scale: 1, offsetX: 0, originY: 2 ** 35 },
    ],
    radius: 0.4,
    step: 1,
    ledge: 0.464,
    width: 0.3,
    start: [0.54, 0, 0.8],
    wall: [1, 0, 0.5],
    roof: [0, 0],
    speed: 9,
    angle: 0.03,
    expected: [0.6, 0, 0.841, 0, 0, 0.219],
  },
];

for (const route of routes)
  for (const { scale, offsetX, originY } of route.coordinates ?? [
    { scale: 1, offsetX: 0, originY: 0 },
  ])
    test(`${route.name}, scale=${scale}, X=${offsetX}, Y=${originY}`, () => {
      const settings = {
        ...HUMAN_BODY,
        capsuleRadius: route.radius * scale,
        stepHeight: route.step * scale,
        capsuleHeight: HUMAN_BODY.capsuleHeight * scale,
        walkSpeed: HUMAN_BODY.walkSpeed * scale,
        sprintSpeed: HUMAN_BODY.sprintSpeed * scale,
        gravity: HUMAN_BODY.gravity * scale,
        fallGravity: HUMAN_BODY.fallGravity * scale,
      };
      const scaledBlock = (...bounds: Parameters<typeof block>) =>
        block(...(bounds.map((value) => value * scale) as Parameters<typeof block>));
      const body = createCharacterBody(settings);
      const [wallX, wallZ, wallWidth] = route.wall;
      const meshes = [
        scaledBlock(-20, -1, -20, 20, 0, 20),
        scaledBlock(1, 0, -1, 1 + route.width, route.ledge, 1),
        scaledBlock(wallX, 0, wallZ, wallX + wallWidth, 3, wallZ + 0.1),
      ];
      if (route.roof[1])
        meshes.push(scaledBlock(route.roof[0], route.roof[1], -5, 10, route.roof[1] + 1, 5));
      for (const mesh of meshes) mesh.position.x += offsetX;
      const geometry = meshCollision(meshes);
      assert.ok(geometry.tree.triangles.every(Number.isFinite));
      const world = rebase(geometry, originY);
      body.setWorld(world);
      body.place(
        route.start[0] * scale + offsetX,
        route.start[1] * scale + originY,
        route.start[2] * scale,
      );
      const input = { wishX: Math.cos(route.angle), wishZ: Math.sin(route.angle), sprint: false };
      body.velocity.set([input.wishX * route.speed * scale, 0, input.wishZ * route.speed * scale]);
      for (let frame = 0; frame < 20; frame++) {
        const before = [...body.feet];
        body.advance(1 / 120, input);
        assert.ok(
          Math.hypot(body.feet[0] - before[0], body.feet[2] - before[2]) < route.radius * scale,
        );
        assert.ok(
          (body.feet[1] - originY) / scale >= -1e-6 &&
            (body.feet[1] - originY) / scale <= route.ledge + 1e-6,
        );
      }
      const observed = [
        body.feet[0] - offsetX,
        body.feet[1] - originY,
        body.feet[2],
        ...body.velocity,
      ].map((value) => value / scale);
      observed.forEach((value, axis) => assert.ok(Math.abs(value - route.expected[axis]) < 0.001));
      assert.equal(body.onGround, true);
      world.resolveCapsule(
        { feet: body.feet, radius: settings.capsuleRadius, height: settings.capsuleHeight },
        (touch) => {
          assert.ok(
            touch.depth / scale < 0.001,
            'the reference ends without a millimetre of unresolved penetration',
          );
        },
      );
    });
