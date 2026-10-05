// The settings and damping a body keeps (`objectPhysics.ts`); its requests of a host are in
// `objectPhysicsHost.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAMPING } from './layout.ts';
import { ObjectPhysics } from './objectPhysics.ts';
import { PHYSICS_STEP } from './options.ts';
import { SOFT_DAMPING } from './soft.ts';

test('a body keeps the settings it declares, and a type or word alone takes the defaults', () => {
  const shape = { type: 'box', halfExtents: [1, 2, 3] } as const;
  const body = new ObjectPhysics({
    ...{ type: 'static', shape, sensor: true, ccd: true, decorative: true, mass: 7 },
    ...{ gravityScale: 2, friction: 0.3, restitution: 0.4, damping: { linear: 0, angular: 0.2 } },
  });
  assert.deepEqual(
    [body.type, body.shape, body.soft, body.sensor, body.ccd, body.decorative],
    ['static', shape, null, true, true, true],
  );
  assert.deepEqual(body.damping, { linear: 0, angular: 0.2 });
  assert.deepEqual(
    [body.mass, body.gravityScale, body.friction, body.restitution],
    [7, 2, 0.3, 0.4],
  );
  for (const plain of [new ObjectPhysics({}), new ObjectPhysics('dynamic')]) {
    assert.equal(plain.type, 'dynamic');
    assert.deepEqual([plain.sensor, plain.ccd, plain.decorative], [false, false, false]);
    assert.deepEqual(
      [plain.mass, plain.gravityScale, plain.friction, plain.restitution],
      [undefined, 1, undefined, undefined],
      'the material’s matter and the world’s gravity',
    );
    assert.deepEqual(plain.damping, { linear: DAMPING, angular: DAMPING });
  }
  assert.equal(new ObjectPhysics('kinematic').type, 'kinematic');
  assert.deepEqual([body._host, body._state, body._index], [null, null, -1], 'in no simulation');
});

test('a body keeps the damping it declares, the simulation’s own left unset, and refuses a negative one', () => {
  assert.deepEqual(new ObjectPhysics({ damping: { linear: 0 } }).damping, {
    linear: 0,
    angular: DAMPING,
  });
  assert.deepEqual(new ObjectPhysics({ damping: { angular: 0 } }).damping, {
    linear: DAMPING,
    angular: 0,
  });
  for (const damping of [{ angular: -2 }, { linear: -0.1 }, { linear: Number.NaN }])
    assert.throws(
      () => new ObjectPhysics({ damping }),
      (error: unknown) =>
        error instanceof RangeError && error.message.includes(String(Object.values(damping)[0])),
    );
});

test('a soft body that declares no damping loses a hundredth of its speed a step, whatever its type; one declaring its own keeps it', () => {
  // The rate of 0.99 a step of 60 Hz: 0.603 per second.
  assert.ok(Math.abs(Math.exp(-SOFT_DAMPING * PHYSICS_STEP) - 0.99) < 1e-12);
  assert.equal(Math.round(SOFT_DAMPING * 1000) / 1000, 0.603);
  // The module damps each of its 5 substeps by 1 − c·h: 0.99 a step to within 2e-5.
  assert.ok(Math.abs((1 - (SOFT_DAMPING * PHYSICS_STEP) / 5) ** 5 - 0.99) < 2e-5);
  for (const type of ['cloth', 'rope', 'volume'] as const) {
    assert.equal(new ObjectPhysics({ type }).damping.linear, SOFT_DAMPING, `${type}: the default`);
    for (const linear of [0, 0.05, 7])
      assert.equal(
        new ObjectPhysics({ type, damping: { linear } }).damping.linear,
        linear,
        `${type}: its own ${linear}`,
      );
  }
  assert.equal(
    new ObjectPhysics('dynamic').damping.linear,
    DAMPING,
    'a rigid body keeps the simulation’s own',
  );
});
