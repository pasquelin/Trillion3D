import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneProxyMotion } from './proxyMotion.ts';
import { floorProxy, proxyIdentity } from './proxy.fixture.ts';

/** Nodes on the root-to-leaf path of `triangle`, and each inner child they hold. */
function pathAndChildren(children: Uint32Array, triangle: number) {
  const nodes = new Set<number>();
  for (let node = 0, found = false; !found;) {
    nodes.add(node);
    let next = -1;
    for (let slot = 0; slot < 4; slot++) {
      const at = node * 12 + slot * 3,
        count = (children[at + 1] >>> 16) & 255,
        first = children[at + 2];
      if (children[at + 1] >>> 24 === 0) continue;
      if (count) found ||= triangle >= first && triangle < first + count;
      else {
        nodes.add(first);
        const range = subtreeRange(children, first);
        if (triangle >= range[0] && triangle < range[1]) next = first;
      }
    }
    if (!found) node = next;
  }
  return nodes;
}

/** First and past-last triangle a subtree holds (the fixture keeps them contiguous). */
function subtreeRange(children: Uint32Array, node: number): [number, number] {
  let low = Infinity,
    high = -Infinity;
  for (let slot = 0; slot < 4; slot++) {
    const at = node * 12 + slot * 3;
    if (children[at + 1] >>> 24 === 0) continue;
    const count = (children[at + 1] >>> 16) & 255,
      range = count
        ? [children[at + 2], children[at + 2] + count]
        : subtreeRange(children, children[at + 2]);
    low = Math.min(low, range[0]);
    high = Math.max(high, range[1]);
  }
  return [low, high];
}

test('the motion bound grows by the nodes a refit let into a ray, never the node count', () => {
  const proxy = floorProxy(32, 2),
    motion = createSceneProxyMotion(proxy);
  assert.equal(motion.grownNodes, 0, 'a still tree keeps the built bound');
  const moved = proxyIdentity();
  moved[12] = 20;
  moved[14] = 3;
  motion.sync((node) => (node === 700 ? moved : proxyIdentity()));
  const expected = pathAndChildren(proxy.data.nodeChildren, 700);
  assert.equal(motion.grownNodes, expected.size);
  assert.ok(expected.size < proxy.nodes / 10, `${expected.size} of ${proxy.nodes} nodes`);
  motion.sync((node) => (node === 700 ? moved : proxyIdentity()));
  assert.equal(motion.dynamic, false);
  assert.equal(motion.grownNodes, expected.size, 'a settled pose keeps the refitted topology');
});
