// Three.js vs sdk-core, scene: the world-matrix update of a whole tree, moved or still, its
// traversal, a camera turned towards a point, and the bounding box of a geometry. The engine's
// world matrices are its own buffer, returned as is; Three's are read flat untimed.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addTransformNode,
  createTransformTree,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
} from '../mathTransformTree.ts';
import { updateNodeMatrixWorld } from '../mathTransformTreeUpdate.ts';
import { visitSubtree } from '../mathTransformTreeStructure.ts';
import { lookAtNode } from '../mathTransformTreeLookAt.ts';
import { boxEmpty, boxExpandByPoint } from '../mathBox.ts';
import { rapport } from './socle.mjs';
import { aPlat } from './oracles/volumes.mjs';
import { N, alea, duel, flatOf, quaternion, rnd } from './oracles/three-duel.mjs';

const TREE = 'packages/sdk-core/mathTransformTreeUpdate.ts';

// One tree of N nodes on each side, every node under a random earlier node, poses drawn once.
// A fresh tree numbers its nodes in insertion order, so node `i` is `objects[i]`.
const root = new THREE.Object3D(),
  objects = [root];
const tree = createTransformTree(N + 2),
  rootNode = addTransformNode(tree, -1);
for (let i = 1; i <= N; i++) {
  const parent = Math.floor(alea() * i),
    q = quaternion();
  const o = new THREE.Object3D();
  o.position.set(rnd(), rnd(), rnd());
  o.quaternion.copy(q);
  o.scale.set(rnd(0.5, 2), rnd(0.5, 2), rnd(0.5, 2));
  objects[parent].add(o);
  objects.push(o);
  const n = addTransformNode(tree, parent);
  assert.equal(n, i);
  setNodePosition(tree, n, o.position.x, o.position.y, o.position.z);
  setNodeQuaternion(tree, n, q.x, q.y, q.z, q.w);
  setNodeScale(tree, n, o.scale.x, o.scale.y, o.scale.z);
}
const worlds = tree.world.subarray(0, objects.length * 16),
  worldsThree = new Float64Array(objects.length * 16);
const oracle = () =>
  flatOf(
    objects.map((o) => o.matrixWorld),
    16,
    worldsThree,
  );

const lines = [];
lines.push(
  await duel({
    nom: 'Object3D.updateMatrixWorld, forced',
    fichier: TREE,
    three: () => root.updateMatrixWorld(true),
    oracle,
    core: () => {
      updateNodeMatrixWorld(tree, rootNode, true);
      return worlds;
    },
  }),
);

lines.push(
  await duel({
    nom: 'Object3D.updateMatrixWorld, still scene',
    fichier: TREE,
    three: () => root.updateMatrixWorld(),
    oracle,
    core: () => {
      updateNodeMatrixWorld(tree, rootNode);
      return worlds;
    },
  }),
);

const count = new Float64Array(1),
  countThree = new Float64Array(1);
lines.push(
  await duel({
    nom: 'Object3D.traverse',
    fichier: 'packages/sdk-core/mathTransformTreeStructure.ts',
    three: () => {
      countThree[0] = 0;
      root.traverse(() => {
        countThree[0]++;
      });
    },
    oracle: () => countThree,
    core: () => {
      count[0] = 0;
      visitSubtree(tree, rootNode, () => {
        count[0]++;
      });
      return count;
    },
  }),
);

// A camera under the eighth node, turned towards N seeded targets; both sides store its
// quaternion, four numbers per target.
const targets = Float64Array.from({ length: N * 3 }, () => rnd(-100, 100));
const UP = new Float64Array([0, 1, 0]);
const cameraThree = new THREE.Camera();
objects[7].add(cameraThree);
const camera = addTransformNode(tree, 7);
const turned = new Float64Array(N * 4),
  turnedThree = new Float64Array(N * 4);

lines.push(
  await duel({
    nom: 'Object3D.lookAt, camera',
    fichier: 'packages/sdk-core/mathTransformTreeLookAt.ts',
    three: () => {
      for (let i = 0; i < N; i++) {
        cameraThree.lookAt(targets[i * 3], targets[i * 3 + 1], targets[i * 3 + 2]);
        const { x, y, z, w } = cameraThree.quaternion;
        turnedThree[i * 4] = x;
        turnedThree[i * 4 + 1] = y;
        turnedThree[i * 4 + 2] = z;
        turnedThree[i * 4 + 3] = w;
      }
    },
    oracle: () => turnedThree,
    core: () => {
      const q = tree.quaternion,
        at = camera * 4;
      for (let i = 0; i < N; i++) {
        lookAtNode(tree, camera, targets[i * 3], targets[i * 3 + 1], targets[i * 3 + 2], UP, true);
        turned[i * 4] = q[at];
        turned[i * 4 + 1] = q[at + 1];
        turned[i * 4 + 2] = q[at + 2];
        turned[i * 4 + 3] = q[at + 3];
      }
      return turned;
    },
  }),
);

// The bounding box of a geometry of 15 N points.
const POINTS = N * 15;
const positions = Float32Array.from({ length: POINTS * 3 }, () => rnd(-50, 50));
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const box = new Float64Array(6);

lines.push(
  await duel({
    nom: 'BufferGeometry.computeBoundingBox',
    fichier: 'packages/sdk-core/mathBox.ts',
    taille: POINTS,
    three: () => geometry.computeBoundingBox(),
    oracle: () => aPlat(geometry.boundingBox),
    core: () => {
      boxEmpty(box, 0);
      for (let i = 0; i < POINTS; i++)
        boxExpandByPoint(box, 0, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      return box;
    },
  }),
);

rapport(
  'three-vs-core-scene',
  lines,
  'sdk-core scene tree and bounds give the same bits as Three.js, at least as fast',
);
