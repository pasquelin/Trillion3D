import { DAG_NODE_FLOATS } from '../types.ts';
import { dagNodeFloor, dagNodeVerdict } from './math.ts';
import { NODE_FIRST_CHILD, NODE_WORLD } from '../packNodes.ts';
import type { dagViewFrames } from './math.ts';

/**
 * Oracle descent: the Node mirror of `../shader/levelWgsl.ts`.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. `nodeFlags` carries
 * each node's verdict — non-zero means « do not descend here » —, and only kept leaves fall back
 * to zero: they alone are what clusters consult next.
 *
 * `prunedFloor` is the smallest floor top-down pruning discarded, per primitive. Above it,
 * residency escalation would demand a subtree the descent did not open, and the pinned fallback
 * arms (`../shader/floorWgsl.ts`).
 *
 * `carried` mirrors `resetPrune` (`../shader/floorWgsl.ts`): a primitive's previous final
 * threshold, when finite and above this frame's, is the one it prunes at — an escalating
 * primitive keeps the coarse levels it escalates toward. Absent: a fresh row, this frame's.
 *
 * Split from `oracle.ts`: it is a whole step, it has its own WGSL mirror, and the oracle
 * that carried it had reached its line limit.
 */
export function dagOracleDescent(
  packed: { nodeCount: number; worldCount: number; nodes: Float32Array; rootNodes: Uint32Array },
  frames: ReturnType<typeof dagViewFrames>,
  carried?: ArrayLike<number>,
) {
  const seuil = Math.max(frames.pixelError, 0);
  const pruneAt = (w: number) => {
    const c = carried?.[w] ?? seuil;
    return c > seuil && c < 3.4e38 ? c : seuil;
  };
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
    const w = nodeInts[n * DAG_NODE_FLOATS + NODE_WORLD];
    if (floor > pruneAt(w)) {
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
