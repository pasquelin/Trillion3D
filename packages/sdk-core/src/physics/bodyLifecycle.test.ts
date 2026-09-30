import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectPhysics, type PhysicsHost } from './objectPhysics.ts';

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

test('body settings and writes are preserved and forwarded to the attached simulation', () => {
  const shape = { type: 'box', halfExtents: [1, 2, 3] } as const;
  const body = new ObjectPhysics({
    type: 'static',
    shape: shape as any,
    sensor: true,
    ccd: true,
    decorative: true,
    mass: 7,
    gravityScale: 2,
    friction: 0.3,
    restitution: 0.4,
    damping: { linear: 0, angular: 0.2 },
  });
  assert.equal(body.type, 'static');
  assert.equal(body.shape, shape);
  assert.equal(body.soft, null);
  assert.deepEqual([body.sensor, body.ccd, body.decorative], [true, true, true]);
  assert.deepEqual(body.damping, { linear: 0, angular: 0.2 });
  assert.deepEqual(
    [body.mass, body.gravityScale, body.friction, body.restitution],
    [7, 2, 0.3, 0.4],
  );
  const { calls, value } = host();
  body._host = value;
  body.mass = 12;
  body.gravityScale = 0;
  body.friction = 0;
  body.restitution = 1;
  assert.deepEqual([body.mass, body.gravityScale, body.friction, body.restitution], [12, 0, 0, 1]);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['rebuild', 'tune', 'tune', 'tune'],
  );
  assert.ok(calls.every((call) => call[1] === body));
  calls.length = 0;
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
  assert.ok(calls.every((call) => call[0] === 'velocity' && call[1] === body));
  const defaults = new ObjectPhysics({});
  assert.equal(defaults.type, 'dynamic');
  assert.deepEqual([defaults.sensor, defaults.ccd, defaults.decorative], [false, false, false]);
  assert.deepEqual(
    [defaults.mass, defaults.gravityScale, defaults.friction, defaults.restitution],
    [undefined, 1, undefined, undefined],
  );
  defaults.mass = undefined;
  defaults.applyImpulse(1);
  defaults.wake();
});

test('shared state reads only fresh linear velocity and detaching retains the latest step', () => {
  const body = new ObjectPhysics('dynamic'),
    { value, calls } = host();
  const state = {
    asleep: new Uint8Array([0, 1]),
    stamp: new Uint32Array([1, 5]),
    velocity: new Float32Array([91, 92, 93, 94, 95, 96, 1, 2, 3, 7, 8, 9]),
  };
  body._attach(value, 1, state);
  assert.equal(body._host, value);
  assert.equal(body._state, state);
  assert.equal(body._index, 1);
  assert.equal(body.asleep, true);
  assert.deepEqual([...body.velocity.elements], [0, 0, 0]);
  state.stamp[1]++;
  assert.deepEqual([...body.velocity.elements], [1, 2, 3]);
  assert.equal(calls.length, 0);
  state.velocity.set([11, 12, 13], 6);
  assert.deepEqual([...body.velocity.elements], [1, 2, 3]);
  state.stamp[1]++;
  body._detach();
  assert.deepEqual([...body.velocity.elements], [11, 12, 13]);
  assert.equal(body.asleep, true);
  assert.equal(body._state, null);
  assert.equal(body._host, null);
  assert.equal(body._index, -1);
  state.asleep[1] = 0;
  state.velocity.fill(0);
  state.stamp[1]++;
  assert.equal(body.asleep, true);
  assert.deepEqual([...body.velocity.elements], [11, 12, 13]);
  body.velocity.set(4, 5, 6);
  assert.equal(calls.length, 0);
  const other = new ObjectPhysics('static');
  assert.equal(other.asleep, false);
  state.asleep[0] = 2;
  other._attach(value, 0, state);
  assert.equal(other.asleep, false);
});

test('contact subscriptions route events and update host interest at the first and last listener', () => {
  const body = new ObjectPhysics('dynamic'),
    { value, calls } = host();
  body._host = value;
  const seen: unknown[] = [];
  const event = { other: null, impulse: 3, point: { x: 1, y: 2, z: 3 } };
  assert.equal(body.listens, false);
  body._emit('leave', event);
  const offContact = body.on('contact', (item) => seen.push(['contact', item]));
  assert.deepEqual(
    calls,
    [['listened', body]],
    'the first subscription enables host events immediately',
  );
  const offEnter = body.on('enter', (item) => seen.push(['enter', item]));
  assert.equal(body.listens, true);
  assert.deepEqual(calls, [['listened', body]]);
  body._emit('contact', event);
  body._emit('enter', event);
  body._emit('leave', event);
  assert.deepEqual(seen, [
    ['contact', event],
    ['enter', event],
  ]);
  offContact();
  assert.equal(body.listens, true);
  assert.equal(calls.length, 1);
  body._emit('contact', event);
  assert.equal(seen.length, 2);
  offEnter();
  assert.equal(body.listens, false);
  assert.deepEqual(calls, [
    ['listened', body],
    ['listened', body],
  ]);
});
