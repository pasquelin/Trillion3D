import { DAG_NODE_FLOATS } from '../types.ts';
import { dagNodeFloor, dagNodeVerdict } from './math.ts';
import { NODE_FIRST_CHILD } from '../packNodes.ts';
import { castsNoShadow } from '../../../page/cut/select.ts';
import type { DagViewFrames } from './math.ts';

/** A kept leaf reached only by the view ahead (`../shader/aheadWgsl.ts`): its pages are requested
 *  ahead and never drawn. */
export const AHEAD_LEAF = 3;

/** One view's node verdict: `-1` rejected — outside, too fine or too coarse —, else its children. */
function keeps(frames: DagViewFrames, nodes: Float32Array, nodeInts: Uint32Array, n: number) {
  const children = dagNodeVerdict(frames, nodes, nodeInts, n);
  if (children < 0 || dagNodeFloor(frames, nodes, nodeInts, n) > frames.pixelError) return -1;
  return children;
}

/**
 * Oracle descent: the Node mirror of `../shader/levelWgsl.ts`.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. `nodeFlags` carries
 * each node's verdict — non-zero means « the camera does not descend here » —, and only kept leaves
 * fall back to zero: they alone are what clusters consult next. A node the camera rejects is tried
 * against the view `ahead`, when there is one, and what that view keeps continues under it alone;
 * its kept leaves take `AHEAD_LEAF`.
 *
 * Top-down pruning drops a subtree whose error floor is above the threshold, unless the subtree
 * is open — it holds the nearest resident ancestor of something missing (`../shader/floorWgsl.ts`).
 *
 * Split from `oracle.ts`: it is a whole step, it has its own WGSL mirror.
 */
export function dagOracleDescent(
  packed: {
    nodeCount: number;
    worldCount: number;
    nodes: Float32Array;
    rootNodes: Uint32Array;
    sprite?: Uint8Array;
  },
  frames: DagViewFrames,
  ahead?: DagViewFrames,
) {
  const { nodes } = packed,
    nodeInts = new Uint32Array(nodes.buffer);
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  /** Pairs: the node, then whether it is the view ahead's alone. */
  const frontier: number[] = [];
  // A light's cut opens no descent on a sprite (`castsNoShadow`, `spriteOf` in the shader).
  for (let w = 0; w < packed.worldCount; w++)
    if (packed.rootNodes[w] !== 0xffffffff && !castsNoShadow(packed.sprite?.[w], frames.light))
      frontier.push(packed.rootNodes[w], 0);
  while (frontier.length) {
    let aheadOnly = frontier.pop() as number;
    const n = frontier.pop() as number;
    let children = aheadOnly ? -1 : keeps(frames, nodes, nodeInts, n);
    if (children < 0 && ahead) {
      children = keeps(ahead, nodes, nodeInts, n);
      aheadOnly = 1;
    }
    if (children < 0) {
      nodeFlags[n] = 2;
      continue;
    }
    if (children) {
      const first = nodeInts[n * DAG_NODE_FLOATS + NODE_FIRST_CHILD];
      for (let c = 0; c < children; c++) frontier.push(first + c, aheadOnly);
      continue;
    }
    nodeFlags[n] = aheadOnly ? AHEAD_LEAF : 0;
  }
  return nodeFlags;
}
