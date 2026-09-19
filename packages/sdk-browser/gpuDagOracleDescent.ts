import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import { dagNodeFloor, dagNodeVerdict } from './gpuDagOracleMath.ts';
import { NODE_FIRST_CHILD, NODE_WORLD } from './gpuDagPackNodes.ts';
import type { dagViewFrames } from './gpuDagOracleMath.ts';

/**
 * Oracle descent: the Node mirror of `gpuDagLevelWgsl.ts`.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. `nodeFlags` carries
 * each node's verdict — non-zero means « do not descend here » —, and only kept leaves fall back
 * to zero: they alone are what clusters consult next.
 *
 * `prunedFloor` is the smallest floor top-down pruning discarded, per primitive. Above it,
 * residency escalation would demand a subtree the descent did not open, and the pinned fallback
 * arms (`gpuDagFloorWgsl.ts`).
 *
 * Split from `gpuDagOracle.ts`: it is a whole step, it has its own WGSL mirror, and the oracle
 * that carried it had reached its line limit.
 */
export function dagOracleDescent(
  packed: { nodeCount: number; worldCount: number; nodes: Float32Array; rootNodes: Uint32Array },
  frames: ReturnType<typeof dagViewFrames>,
) {
  const { nodes } = packed,
    nodeInts = new Uint32Array(nodes.buffer);
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  const prunedFloor = new Float64Array(Math.max(1, packed.worldCount)).fill(Infinity);
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
    const floor = dagNodeFloor(frames, nodes, nodeInts, n);
    if (floor > frames.pixelError) {
      const w = nodeInts[n * DAG_NODE_FLOATS + NODE_WORLD];
      if (floor < prunedFloor[w]) prunedFloor[w] = floor;
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
  return { nodeFlags, prunedFloor };
}
