// Three.js vs sdk-core, scene tree: the world-matrix update when every node moved, when the root
// alone moved, when nothing moved, the ancestors-then-node update, and the traversal. A pose is
// written before each update on both sides, in the timed closure, so both compose and multiply
// the same nodes; the still line is the "no work in a still scene" proof. The engine's world
// matrices are its own buffer, returned as is; Three's are read flat untimed.
import { setNodePosition } from '../../../packages/sdk-core/mathTransformTree.ts';
import {
  updateNodeMatrixWorld,
  updateNodeWorldMatrix,
} from '../../../packages/sdk-core/mathTransformTreeUpdate.ts';
import { visitSubtree } from '../../../packages/sdk-core/mathTransformTreeStructure.ts';
import { rapport } from '../../core/index.ts';
import { N, duel } from '../../oracles/core/three-duel.ts';
import { buildTrees } from '../../oracles/core/three-tree.ts';

const TREE = 'packages/sdk-core/mathTransformTreeUpdate.ts';
const { root, objects, tree, rootNode, worlds, oracle } = buildTrees();
const p = tree.position;

// A pose alternates between two positions on `x` from one call to the next, so no call repeats
// the previous pose and the oracle can replay the pose of the call it checks. Each line starts
// from the same base pose on both sides.
let round = 0;
const moveThree = (i: number, r: number) => (objects[i].position.x = i + (r & 1));
const moveCore = (i: number, r: number) =>
  setNodePosition(tree, i, i + (r & 1), p[i * 3 + 1], p[i * 3 + 2]);
const basePose = () => {
  round = 0;
  for (let i = 0; i <= N; i++) {
    moveThree(i, 0);
    moveCore(i, 0);
  }
  root.updateMatrixWorld(true);
  updateNodeMatrixWorld(tree, rootNode, true);
};
/** Three's answer for the pose the engine's next call will take. */
const oracleAfter = (move: (r: number) => void) => () => {
  move(round + 1);
  root.updateMatrixWorld();
  return oracle();
};
/** Every node moved, or every node but the root. */
const moved = (rootToo: boolean) => (r: number) => {
  for (let i = rootToo ? 0 : 1; i <= N; i++) moveThree(i, r);
};

const lines = [];
basePose();
lines.push(
  await duel({
    name: 'Object3D.updateMatrixWorld, every node moved',
    fichier: TREE,
    three: () => {
      moved(true)(++round);
      root.updateMatrixWorld();
    },
    oracle: oracleAfter(moved(true)),
    core: () => {
      round++;
      for (let i = 0; i <= N; i++) moveCore(i, round);
      updateNodeMatrixWorld(tree, rootNode);
      return worlds;
    },
  }),
);

basePose();
lines.push(
  await duel({
    name: 'Object3D.updateMatrixWorld, root moved',
    fichier: TREE,
    three: () => {
      moveThree(0, ++round);
      root.updateMatrixWorld();
    },
    oracle: oracleAfter((r: number) => moveThree(0, r)),
    core: () => {
      moveCore(0, ++round);
      updateNodeMatrixWorld(tree, rootNode);
      return worlds;
    },
    motif: 'the engine multiplies every node by the new root, Three also recomposes each local',
  }),
);

basePose();
lines.push(
  await duel({
    name: 'Object3D.updateMatrixWorld, still scene',
    fichier: TREE,
    three: () => root.updateMatrixWorld(),
    oracle,
    core: () => {
      updateNodeMatrixWorld(tree, rootNode);
      return worlds;
    },
    motif: 'nothing moved: Three recomposes and multiplies every node, the engine reads its flags',
  }),
);

// `updateWorldMatrix(true, false)` on each node in turn, the node moved just before.
basePose();
lines.push(
  await duel({
    name: 'Object3D.updateWorldMatrix, ancestors and node',
    fichier: TREE,
    three: () => {
      round++;
      for (let i = 1; i <= N; i++) {
        moveThree(i, round);
        objects[i].updateWorldMatrix(true, false);
      }
    },
    oracle: oracleAfter(moved(false)),
    core: () => {
      round++;
      for (let i = 1; i <= N; i++) {
        moveCore(i, round);
        updateNodeWorldMatrix(tree, i, true, false);
      }
      return worlds;
    },
    motif: 'the moved node is recomposed on both sides; Three also recomposes its ancestors',
  }),
);

const count = new Float64Array(1),
  countThree = new Float64Array(1);
lines.push(
  await duel({
    name: 'Object3D.traverse',
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

rapport(
  'three-vs-core-tree',
  lines,
  'sdk-core scene tree gives the same bits as Three.js, at least as fast',
);
