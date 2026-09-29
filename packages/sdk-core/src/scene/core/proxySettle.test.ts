import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneProxyMotion } from './proxyMotion.ts';
import { PROXY_GROUP_OWNED, PROXY_LEAF_OWNED } from './proxyLeaves.ts';
import { mixedProxy, ownedProxy, proxyIdentity } from './proxy.fixture.ts';

/** Sources up to `last` lifted `lift` metres along y, the others at bind. */
const lifted = (lift: number, last: number) => (node: number) => {
  const world = proxyIdentity();
  if (node <= last) world[13] = lift;
  return world;
};

test('a still proxy settles each leaf whose owners agree and keeps only the others owned', () => {
  const motion = createSceneProxyMotion(mixedProxy());
  const { nodeChildren: children, triangleGroups: groups, triangles } = motion.data;
  assert.equal(motion.sync(lifted(5, 1)), 'moved');
  assert.ok(children[1] & PROXY_LEAF_OWNED && children[4] & PROXY_LEAF_OWNED, 'both leaves moved');
  assert.equal(motion.sync(lifted(5, 1)), 'settled');
  assert.equal(children[1] & PROXY_LEAF_OWNED, 0, 'the lone owner leaf reads no owner word');
  assert.equal(groups[0], 0, 'nor its group word, for the surface cache');
  assert.deepEqual(
    [...triangles.subarray(0, 9)],
    [0, 5, 0, 1, 5, 0, 0, 6, 0],
    'written at its pose',
  );
  assert.ok(children[4] & PROXY_LEAF_OWNED, 'the door merged with its frame stays owned');
  assert.equal(groups[1], (1 | PROXY_GROUP_OWNED) >>> 0);
  assert.deepEqual([...triangles.subarray(9)], [2, 0, 0, 3, 0, 0, 2, 1, 0], 'canonical');
  assert.equal(motion.dynamic, true);
  assert.equal(motion.settling, false, 'nothing left that can settle: the host stops asking');
  assert.equal(motion.sync(lifted(5, 1)), null);
  // The frame joins the door: one pose again, the last leaf settles past the last still gap.
  assert.equal(motion.sync(lifted(5, 2)), 'moved');
  assert.equal(motion.sync(lifted(5, 2)), null);
  assert.equal(motion.sync(lifted(5, 2)), 'settled');
  assert.equal(motion.dynamic, false);
  assert.deepEqual([...triangles.subarray(9)], [2, 5, 0, 3, 5, 0, 2, 6, 0]);
});

test('motion slower than the frame rate does not rewrite triangles each cycle', () => {
  const motion = createSceneProxyMotion(ownedProxy()),
    world = proxyIdentity();
  const changes: string[] = [];
  let rewrites = 0;
  for (let frame = 0; frame < 12; frame++) {
    if (frame % 2 === 0) world[12] = frame + 1;
    changes.push(String(motion.sync(() => world)));
    if (motion.take().triangles) rewrites++;
  }
  // One settle learns the gap between two motions, one resume rewrites canonical; then nothing.
  assert.deepEqual(changes.slice(0, 4), ['moved', 'settled', 'moved', 'null']);
  assert.equal(rewrites, 2);
  assert.equal(motion.dynamic, true);
  assert.equal(changes[11], 'null', 'a still streak no longer than the gap waits');
  assert.equal(
    motion.sync(() => world),
    'settled',
    'past the gap, the motion has stopped',
  );
  assert.equal(motion.dynamic, false);
});
