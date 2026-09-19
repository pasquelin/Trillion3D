// One scene tree on each side for the tree benches: N nodes under the root, every node under a
// random earlier node, poses drawn once. A fresh engine tree numbers its nodes in insertion
// order, so node `i` is `objects[i]` and the engine's world buffer compares flat to Three's.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from '../../mathTransformTree.ts';
import { N, alea, flatOf, quaternion, rnd } from './three-duel.mjs';

export function buildTrees(n = N) {
  const root = new THREE.Object3D(),
    objects = [root];
  const tree = createTransformTree(n + 2),
    rootNode = addTransformNode(tree, -1);
  for (let i = 1; i <= n; i++) {
    const parent = Math.floor(alea() * i),
      q = quaternion();
    const o = new THREE.Object3D();
    o.position.set(rnd(), rnd(), rnd());
    o.quaternion.copy(q);
    o.scale.set(rnd(0.5, 2), rnd(0.5, 2), rnd(0.5, 2));
    objects[parent].add(o);
    objects.push(o);
    const node = addTransformNode(tree, parent);
    assert.equal(node, i);
    setNodePosition(tree, node, o.position.x, o.position.y, o.position.z);
    setNodeQuaternion(tree, node, q.x, q.y, q.z, q.w);
    setNodeScale(tree, node, o.scale.x, o.scale.y, o.scale.z);
  }
  const worlds = tree.world.subarray(0, objects.length * 16),
    worldsThree = new Float64Array(objects.length * 16);
  const oracle = () =>
    flatOf(
      objects.map((o) => o.matrixWorld),
      16,
      worldsThree,
    );
  return { root, objects, tree, rootNode, worlds, oracle };
}
