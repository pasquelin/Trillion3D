/** Transform tree and batches: a real tree, updated by the engine, drawn from above. */
import {
  addTransformNode,
  createTransformTree,
  lookAtNode,
  nodeWorldDirection,
  nodeWorldPosition,
  reparentTransformNode,
  setNodePosition,
  setNodeQuaternion,
  updateNodeMatrixWorld,
} from './engine.ts';
import { canvasView, formatNumber, slider, valueView } from './kit.ts';
import type { DemoDef, DemoState } from './kit.ts';
import { drawVectors } from './draw.ts';
import type { TransformTree } from './engine.ts';

/** A root with three children in a row, the pose of the root driven by the reader. */
function builtTree(state: DemoState, children = 3) {
  const tree = createTransformTree(8);
  const root = addTransformNode(tree, -1);
  const half = state.turn * 0.5;
  setNodePosition(tree, root, state.x, 0, 0);
  setNodeQuaternion(tree, root, 0, Math.sin(half), 0, Math.cos(half));
  const nodes = [];
  for (let index = 0; index < children; index++) {
    const node = addTransformNode(tree, root);
    setNodePosition(tree, node, 1 + index, 0, 0);
    nodes.push(node);
  }
  updateNodeMatrixWorld(tree, root, true);
  return { tree, root, nodes };
}

const POSE = [
  slider('x', 'root position x', -3, 3, 0, 0.1),
  slider('turn', 'root rotation (rad)', 0, 6.28, 0.6, 0.01),
];

const read = (tree: TransformTree, node: number) => {
  const out = new Float64Array(3);
  nodeWorldPosition(out, tree, node);
  return out;
};

export const TREE_DEMOS: Record<string, DemoDef> = {
  createTransformTree: {
    controls: POSE,
    run(state) {
      const { tree, root, nodes } = builtTree(state);
      return [
        valueView('what the arrays hold', [
          ['nodes served', String(tree.end)],
          ['root world position', Array.from(read(tree, root), formatNumber).join(', ')],
          ...nodes.map((node, index): [string, string] => [
            `child ${index} world position`,
            Array.from(read(tree, node), formatNumber).join(', '),
          ]),
        ]),
        canvasView('the tree from above: the root and its children, after one update', (c, w, h) =>
          drawVectors(c, w, h, [
            { v: read(tree, root), colour: '#3987e5', label: 'root' },
            ...nodes.map((node, index) => ({
              v: read(tree, node),
              colour: '#d95926',
              label: `child ${index}`,
            })),
          ]),
        ),
      ];
    },
  },
  updateNodeMatrixWorld: {
    controls: POSE,
    run(state) {
      const { tree, root, nodes } = builtTree(state);
      const before = read(tree, nodes[0]);
      setNodePosition(tree, root, state.x + 2, 0, 0);
      const stale = read(tree, nodes[0]);
      updateNodeMatrixWorld(tree, root, false);
      const after = read(tree, nodes[0]);
      return [
        valueView('the child, before and after the root moves', [
          ['after the first update', Array.from(before, formatNumber).join(', ')],
          ['root moved, nothing updated yet', Array.from(stale, formatNumber).join(', ')],
          ['after updateNodeMatrixWorld(tree, root)', Array.from(after, formatNumber).join(', ')],
          ['note', 'a pose written is a pose marked; the update decides whom to visit'],
        ]),
      ];
    },
  },
  nodeWorldPosition: {
    controls: POSE,
    run(state) {
      const { tree, nodes } = builtTree(state);
      const node = nodes[0];
      const direction = new Float64Array(3);
      nodeWorldDirection(direction, tree, node, false);
      const forward = new Float64Array(3);
      nodeWorldDirection(forward, tree, node, true);
      return [
        valueView('the reads of one node', [
          ['nodeWorldPosition', Array.from(read(tree, node), formatNumber).join(', ')],
          ['nodeWorldDirection (object, +z)', Array.from(direction, formatNumber).join(', ')],
          ['nodeWorldDirection (viewer, −z)', Array.from(forward, formatNumber).join(', ')],
        ]),
      ];
    },
  },
  lookAtNode: {
    controls: [slider('tx', 'target x', -4, 4, 2, 0.1), slider('tz', 'target z', -4, 4, 3, 0.1)],
    run(state) {
      const tree = createTransformTree(4);
      const node = addTransformNode(tree, -1);
      setNodePosition(tree, node, 0, 0, 0);
      lookAtNode(tree, node, state.tx, 0, state.tz, [0, 1, 0], true);
      updateNodeMatrixWorld(tree, node, true);
      const forward = new Float64Array(3);
      nodeWorldDirection(forward, tree, node, true);
      return [
        valueView('a viewer turned toward the target', [
          ['target', `${formatNumber(state.tx)}, 0, ${formatNumber(state.tz)}`],
          ['its forward direction', Array.from(forward, formatNumber).join(', ')],
        ]),
        canvasView('from above', (c, w, h) =>
          drawVectors(c, w, h, [
            { v: new Float64Array([state.tx, 0, state.tz]), colour: '#d95926', label: 'target' },
            { v: forward, colour: '#3987e5', label: 'forward' },
          ]),
        ),
      ];
    },
  },
  reparentTransformNode: {
    controls: POSE,
    run(state) {
      const { tree, root, nodes } = builtTree(state);
      const child = nodes[0];
      const attached = read(tree, child);
      reparentTransformNode(tree, child, -1);
      updateNodeMatrixWorld(tree, root, true);
      updateNodeMatrixWorld(tree, child, true);
      return [
        valueView('the child, attached then detached', [
          ['under the root', Array.from(attached, formatNumber).join(', ')],
          ['reparented to the world', Array.from(read(tree, child), formatNumber).join(', ')],
          ['note', 'matrices do not move until the next update, like the reference `add`'],
        ]),
      ];
    },
  },
};
