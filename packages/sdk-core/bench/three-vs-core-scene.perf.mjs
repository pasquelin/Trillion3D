// Three.js vs sdk-core, scene: a camera turned towards a point, and the bounding box of a
// geometry. Both sides store the camera's quaternion in the same loop, four numbers per target.
import * as THREE from 'three';
import { addTransformNode } from '../mathTransformTree.ts';
import { lookAtNode } from '../mathTransformTreeLookAt.ts';
import { boxEmpty, boxExpandByPoint } from '../mathBox.ts';
import { rapport } from './socle.mjs';
import { aPlat } from './oracles/volumes.mjs';
import { N, duel, rnd } from './oracles/three-duel.mjs';
import { buildTrees } from './oracles/three-tree.mjs';

// A camera under the eighth node of a tree, turned towards N seeded targets.
const { objects, tree } = buildTrees();
const targets = Float64Array.from({ length: N * 3 }, () => rnd(-100, 100));
const UP = new Float64Array([0, 1, 0]);
const cameraThree = new THREE.Camera();
objects[7].add(cameraThree);
const camera = addTransformNode(tree, 7);
const turned = new Float64Array(N * 4),
  turnedThree = new Float64Array(N * 4);

const lines = [];
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
  'sdk-core camera and bounds give the same bits as Three.js, at least as fast',
);
