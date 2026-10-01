import test from 'node:test';
import assert from 'node:assert/strict';
import { DAMPING } from './layout.ts';
import { ObjectPhysics, type ContactEvent, type PhysicsHost } from './objectPhysics.ts';

/** A host recording each request a body makes of it. */
function host() {
  const calls: unknown[][] = [];
  const value = Object.fromEntries(
    ['rebuild', 'tune', 'velocity', 'impulse', 'wake', 'listened'].map((name) => [
      name,
      (...args: unknown[]) => calls.push([name, ...args]),
    ]),
  ) as unknown as PhysicsHost;
  return { calls, value };
}
const touch: ContactEvent = { other: null, impulse: 3, point: { x: 1, y: 2, z: 3 } };

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

test('a write asks the attached simulation to rebuild or tune the body; detached, it is only kept', () => {
  const detached = new ObjectPhysics('dynamic');
  detached.mass = 3;
  detached.gravityScale = 2;
  detached.friction = 0.4;
  detached.restitution = 0.8;
  detached.applyImpulse(1, 2, 3);
  detached.applyImpulse({ x: 1, y: 2, z: 3 });
  detached.wake();
  detached.velocity.set(1, 2, 3);
  assert.deepEqual(
    [detached.mass, detached.gravityScale, detached.friction, detached.restitution],
    [3, 2, 0.4, 0.8],
  );
  const body = new ObjectPhysics('dynamic'),
    { calls, value } = host();
  body._host = value;
  body.mass = 12;
  body.gravityScale = 0;
  body.friction = 0;
  body.restitution = 1;
  body.mass = undefined;
  assert.deepEqual(
    [body.mass, body.gravityScale, body.friction, body.restitution],
    [undefined, 0, 0, 1],
  );
  assert.deepEqual(calls, [
    ['rebuild', body],
    ['tune', body],
    ['tune', body],
    ['tune', body],
    ['rebuild', body],
  ]);
});

test('an impulse reaches the simulation as three numbers, given so or as a vector; a wake too', () => {
  const body = new ObjectPhysics('dynamic'),
    { calls, value } = host();
  body._host = value;
  body.applyImpulse(4);
  body.applyImpulse(1, 2, 3);
  body.applyImpulse({ x: -3, y: 5, z: 7 });
  body.wake();
  assert.deepEqual(calls, [
    ['impulse', body, 4, 0, 0],
    ['impulse', body, 1, 2, 3],
    ['impulse', body, -3, 5, 7],
    ['wake', body],
  ]);
  calls.length = 0;
  body.velocity.set(2, 3, 4);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(([name, of]) => name === 'velocity' && of === body));
});

test('the velocity is read from the last step that wrote the slot; detached, the last read is kept', () => {
  const body = new ObjectPhysics('dynamic'),
    { value, calls } = host();
  const state = {
    asleep: new Uint8Array([0, 1]),
    stamp: new Uint32Array([1, 5]),
    velocity: new Float32Array([91, 92, 93, 94, 95, 96, 1, 2, 3, 7, 8, 9]),
  };
  body._attach(value, 1, state);
  assert.deepEqual([body._host, body._state, body._index], [value, state, 1]);
  assert.equal(body.asleep, true);
  assert.deepEqual([...body.velocity.elements], [0, 0, 0], 'no step since it was attached');
  state.stamp[1]++;
  assert.deepEqual([...body.velocity.elements], [1, 2, 3], 'the linear velocity of its slot');
  state.velocity.set([11, 12, 13], 6);
  assert.deepEqual([...body.velocity.elements], [1, 2, 3], 'no step since it was read');
  assert.equal(calls.length, 0, 'a read asks nothing of the simulation');
  state.stamp[1]++;
  body._detach();
  assert.deepEqual([body._host, body._state, body._index], [null, null, -1]);
  assert.deepEqual([...body.velocity.elements], [11, 12, 13], 'the last step, read on leaving');
  assert.equal(body.asleep, true);
  state.asleep[1] = 0;
  state.velocity.fill(0);
  state.stamp[1]++;
  assert.equal(body.asleep, true, 'what it left with');
  assert.deepEqual([...body.velocity.elements], [11, 12, 13]);
  const other = new ObjectPhysics('static');
  assert.equal(other.asleep, false);
  state.asleep[0] = 2;
  other._attach(value, 0, state);
  assert.equal(other.asleep, false, 'only 1 is asleep');
});

test('contact handlers hear their own event; the host hears the first and the last of them', () => {
  const body = new ObjectPhysics('dynamic'),
    { value, calls } = host();
  body._host = value;
  const seen: unknown[] = [];
  assert.equal(body.listens, false);
  body._emit('leave', touch);
  const offContact = body.on('contact', (event) => seen.push(['contact', event]));
  assert.deepEqual(calls, [['listened', body]]);
  const offEnter = body.on('enter', (event) => seen.push(['enter', event]));
  const offAgain = body.on('enter', (event) => seen.push(['again', event]));
  assert.equal(body.listens, true);
  assert.equal(calls.length, 1, 'already listened to');
  body._emit('contact', touch);
  body._emit('enter', touch);
  body._emit('leave', touch);
  assert.deepEqual(seen, [
    ['contact', touch],
    ['enter', touch],
    ['again', touch],
  ]);
  offContact();
  offAgain();
  assert.equal(body.listens, true);
  assert.equal(calls.length, 1);
  body._emit('contact', touch);
  assert.equal(seen.length, 3);
  offEnter();
  assert.equal(body.listens, false);
  assert.deepEqual(calls, [
    ['listened', body],
    ['listened', body],
  ]);
  const detached = new ObjectPhysics('dynamic');
  detached.on('contact', () => seen.push('detached'))();
  assert.equal(detached.listens, false);
});
