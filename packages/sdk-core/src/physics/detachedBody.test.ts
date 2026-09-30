import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectPhysics } from './objectPhysics.ts';
import { physicsMatterOf } from './matter.ts';

test('detached body setters and contact listeners work before a simulation is attached', () => {
  const body = new ObjectPhysics({ type: 'dynamic', damping: { angular: 0 } });
  assert.equal(body._index, -1);
  assert.equal(body.damping.angular, 0);
  body.gravityScale = 2;
  body.friction = 0.4;
  body.restitution = 0.8;
  body.applyImpulse(1, 2, 3);
  body.applyImpulse({ x: 1, y: 2, z: 3 });
  assert.deepEqual([body.gravityScale, body.friction, body.restitution], [2, 0.4, 0.8]);
  const heard: number[] = [];
  const offA = body.on('contact', () => heard.push(1));
  const offB = body.on('contact', () => heard.push(2));
  body._emit('contact', { other: null, impulse: 3, point: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(heard, [1, 2]);
  offA();
  offB();
  assert.equal(body.listens, false);
  assert.throws(
    () => new ObjectPhysics({ type: 'dynamic', damping: { angular: -2 } }),
    /-2 angular/,
  );
});

test('an empty material group receives finite positive default matter', () => {
  const matter = physicsMatterOf([]);
  assert.ok(Number.isFinite(matter.density) && matter.density > 0);
  assert.ok(Number.isFinite(matter.friction) && matter.friction >= 0);
  assert.ok(Number.isFinite(matter.restitution) && matter.restitution >= 0);
});
