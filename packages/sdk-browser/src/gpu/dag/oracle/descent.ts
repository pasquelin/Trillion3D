import { DAG_NODE_FLOATS } from '../types.ts';
import { dagNodeFloor, dagNodeVerdict } from './math.ts';
import { NODE_FIRST_CHILD } from '../packNodes.ts';
import type { dagViewFrames } from './math.ts';

/**
 * Oracle descent: the Node mirror of `../shader/levelWgsl.ts`.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. `nodeFlags` carries
 * each node's verdict — non-zero means « do not descend here » —, and only kept leaves fall back
 * to zero: they alone are what clusters consult next.
 *
 * Top-down pruning drops a subtree whose error floor is above the threshold, unless the subtree
 * is open — it holds the nearest resident ancestor of something missing (`../shader/floorWgsl.ts`).
 *
 * Split from `oracle.ts`: it is a whole step, it has its own WGSL mirror.
 */
export function dagOracleDescent(
  packed: { nodeCount: number; worldCount: number; nodes: Float32Array; rootNodes: Uint32Array },
  frames: ReturnType<typeof dagViewFrames>,
) {
  const { nodes } = packed,
    nodeInts = new Uint32Array(nodes.buffer);
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  const frontier: number[] = [];
  for (let w = 0; w < packed.worldCount; w++)
    if (packed.rootNodes[w] !== 0xffffffff) frontier.push(packed.rootNodes[w]);
  while (frontier.length) {
    const n = frontier.pop() as number;
    const children = dagNodeVerdict(frames, nodes, nodeInts, n);
    if (children < 0) {
      nodeFlags[n] = 2;
      continue;
    }
    if (dagNodeFloor(frames, nodes, nodeInts, n) > frames.pixelError) {
      nodeFlags[n] = 2;
      continue;
    }
    if (children) {
      const first = nodeInts[n * DAG_NODE_FLOATS + NODE_FIRST_CHILD];
      for (let c = 0; c < children; c++) frontier.push(first + c);
      continue;
    }
    nodeFlags[n] = 0;
  }
  return nodeFlags;
}
