import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterBody } from './characterBody.ts';
import { HUMAN_BODY } from './characterSettings.ts';
import { triangleCollision } from './characterCollision.ts';
import { buildTriangleTree } from './triangleTree.ts';

const still = { wishX: 0, wishZ: 0, sprint: false };

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

test('a successful step keeps the incoming horizontal speed and a rejected step keeps the stopped pose', async () => {
  const { Mesh } = await import('../world/object/mesh.ts');
  const { box } = await import('../world/geometry/basic.ts');
  const { meshCollision } = await import('./meshTriangles.ts');
  for (const stepHeight of [0.2, 0.4]) {
    const floor = new Mesh(box(40, 1, 40));
    floor.position.y = 2.5;
    const ledge = new Mesh(box(10, 0.3, 20));
    ledge.position.set(6, 3.15, 0);
    const body = createCharacterBody({ ...HUMAN_BODY, stepHeight });
    body.setWorld(meshCollision([floor, ledge]));
    body.place(0.7, 3, 0);
    body.velocity[0] = 3.5;
    let climbed = false;
    for (let i = 0; i < 12; i++) {
      body.advance(1 / 120, { ...still, wishX: 1 });
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

test('brushing a ledge during ascent preserves the jump and does not report an upward landing', async () => {
  const { meshCollision } = await import('./meshTriangles.ts');
  const { block } = await import('./character.fixture.ts');
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

test('a horizontal contact can land with exactly zero vertical impact', async () => {
  const { meshCollision } = await import('./meshTriangles.ts');
  const { block } = await import('./character.fixture.ts');
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
