import { MATRIX_VALUES, multiplyMatrix4 } from '../sdk-core/src/index.ts';
import type { HostGraphNode } from './hostGraphNodes.ts';
import { hostLocalInto } from './hostWorldMatrices.ts';

/**
 * World matrix of ONE host node, computed by the engine from the local poses of its ancestor
 * chain.
 *
 * This is the reference's `updateWorldMatrix(true, false)` rule, term for term: the root sets its
 * local matrix, then each descendant multiplies its parent's by its own. Both formulas are the
 * core's — pose composition (`hostLocalInto`) and product (`multiplyMatrix4`) — in the same
 * order: the same bits, negative scales, `-0` and shears included.
 *
 * Nothing is asked of the host library and nothing is written to it: its `matrixWorld` stays
 * what it was. The engine keeps its copy in the buffer the caller hands it.
 *
 * No allocation per call: the walked chain lives in an array reused from call to call, grown
 * only by a graph deeper than every one seen before it.
 */

const local = new Float64Array(MATRIX_VALUES);
let chain: (HostGraphNode | undefined)[] = new Array(64);

/** World matrix of `node` written into `out`, which is returned. `out` may be any buffer. */
export function hostWorldChainInto(out: Float64Array, node: HostGraphNode) {
  let depth = 0;
  for (let walk: HostGraphNode | null = node; walk; walk = walk.parent) {
    if (depth === chain.length) chain = chain.concat(new Array<undefined>(chain.length));
    chain[depth++] = walk;
  }
  // `chain[depth - 1]` is the root: its world matrix is its local matrix, as in the
  // reference. The product is computed IN PLACE — `multiplyMatrix4` reads its thirty-two inputs
  // before writing any output, so `out` can be both the parent's world and the child's.
  hostLocalInto(out, chain[depth - 1] as HostGraphNode);
  for (let rank = depth - 2; rank >= 0; rank--) {
    hostLocalInto(local, chain[rank] as HostGraphNode);
    multiplyMatrix4(out, out, local);
  }
  // The chain is released: keeping host nodes here would retain its scene after an unload.
  for (let rank = 0; rank < depth; rank++) chain[rank] = undefined;
  return out;
}
