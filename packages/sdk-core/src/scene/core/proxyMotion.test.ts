import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneProxyMotion } from './proxyMotion.ts';
import { ownedProxy, proxyIdentity } from './proxy.fixture.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} != ${expected}`);

test('moving one shared owner leaves its stationary surface and other sessions intact', () => {
  const proxy = ownedProxy(),
    before = proxy.data.nodeBounds.slice();
  const motion = createSceneProxyMotion(proxy),
    other = createSceneProxyMotion(proxy);
  const identity = proxyIdentity(),
    moved = proxyIdentity();
  assert.equal(
    motion.sync(() => identity),
    false,
  );
  moved[12] = 10;
  assert.equal(
    motion.sync((node) => (node === 0 ? moved : identity)),
    true,
  );
  close(motion.bounds[0], 0);
  close(motion.bounds[3], 11);
  assert.equal(motion.transforms[12], 10);
  assert.equal(motion.transforms[28], 0);
  assert.deepEqual(proxy.data.nodeBounds, before);
  assert.deepEqual(other.data.nodeBounds, before);
  assert.equal(motion.data.triangles, proxy.data.triangles, 'canonical geometry remains immutable');
  assert.equal(
    motion.sync((node) => (node === 0 ? moved : identity)),
    false,
  );
  assert.equal(motion.revision, 1);
  assert.ok(motion.hostBytes >= motion.transforms.byteLength + motion.data.bindWorlds.byteLength);
});

test('absent partition owners follow their mapped parent and the wrapper', () => {
  const proxy = ownedProxy();
  proxy.data.sourceParents[0] = 2;
  const motion = createSceneProxyMotion(proxy),
    parent = proxyIdentity(),
    wrapper = proxyIdentity();
  parent[13] = 5;
  wrapper[12] = -3;
  assert.equal(
    motion.sync((node) => (node === 2 ? parent : node === -1 ? wrapper : undefined)),
    true,
  );
  close(motion.transforms[13], 5);
  close(motion.transforms[28], -3);
  close(motion.bounds[0], -3);
  close(motion.bounds[4], 6);
});

test('irrelevant source movement does not switch the static path or refit', () => {
  const motion = createSceneProxyMotion(ownedProxy()),
    identity = proxyIdentity(),
    camera = proxyIdentity();
  camera[12] = 100;
  assert.equal(
    motion.sync((node) => (node === 2 ? camera : identity)),
    false,
  );
  assert.equal(motion.dynamic, false);
});

test('a retained singular plane follows translation and rotation without collapsing', () => {
  const proxy = ownedProxy();
  proxy.data.bindWorlds[10] = 0;
  const motion = createSceneProxyMotion(proxy),
    plane = proxyIdentity(),
    identity = proxyIdentity();
  plane[10] = 0;
  plane[12] = 3;
  assert.equal(
    motion.sync((node) => (node === 0 ? plane : identity)),
    true,
  );
  close(motion.bounds[3], 4);
  // The flattened XY plane rotates to YZ, preserving its two independent local directions.
  plane[0] = 0;
  plane[2] = -1;
  plane[12] = 0;
  assert.equal(
    motion.sync((node) => (node === 0 ? plane : identity)),
    true,
  );
  close(motion.bounds[2], -1);
  close(motion.bounds[4], 1);
});

test('returning a translated owner to bind restores its geometry without cumulative drift', () => {
  const motion = createSceneProxyMotion(ownedProxy()),
    world = proxyIdentity();
  world[12] = 1234;
  motion.sync(() => world);
  world[12] = 0;
  motion.sync(() => world);
  close(motion.bounds[0], 0);
  close(motion.bounds[3], 1);
  assert.equal(motion.transforms[12], 0);
  assert.equal(
    motion.sync(() => world),
    false,
  );
});

test('refit counts each node it ever widened once, and a still session widens none', () => {
  const motion = createSceneProxyMotion(ownedProxy());
  const identity = proxyIdentity(),
    moved = proxyIdentity();
  motion.sync(() => identity);
  assert.equal(motion.widenedNodes, 0, 'no motion, no widened node');
  moved[12] = 5;
  motion.sync((node) => (node === 1 ? moved : identity));
  assert.equal(motion.widenedNodes, 1, 'the one node over the moved owner');
  moved[12] = 7;
  motion.sync((node) => (node === 1 ? moved : identity));
  assert.equal(motion.widenedNodes, 1, 'the same node refitted again is not counted twice');
});
