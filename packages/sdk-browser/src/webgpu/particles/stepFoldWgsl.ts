import { WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The max of a workgroup's lanes' pairs through a workgroup array, halving: every lane gets it. */
const LANES_FOLD_WGSL = wgslBlock(
  'LANES_FOLD_WGSL',
  [WORKGROUP_THREADS_WGSL],
  `
var<workgroup> lanes: array<vec2u, WORKGROUP_THREADS>;
fn foldLanes(local: u32, span: vec2u) -> vec2u {
  lanes[local] = span;
  for (var half = (WORKGROUP_THREADS/2u); half > 0u; half >>= 1u) {
    workgroupBarrier();
    if (local < half) { lanes[local] = max(lanes[local], lanes[local + half]); }
  }
  workgroupBarrier();
  return lanes[0];
}`,
)

/** The step's fold of its lanes: by subgroup, the subgroups' leaders then joining two workgroup
 *  words — one pair of atomics a subgroup, not one a live slot —; else the array fold. */
export const stepFoldWgsl = (subgroups: boolean) =>
  subgroups
    ? wgslBlock(
        'stepFoldWgsl(true)',
        [],
        `
var<workgroup> low: atomic<u32>;
var<workgroup> high: atomic<u32>;
fn foldStep(local: u32, span: vec2u) -> vec2u {
  let held = subgroupMax(span);
  if (subgroupElect() && held.y != 0u) { atomicMax(&low, held.x); atomicMax(&high, held.y); }
  workgroupBarrier();
  return vec2u(atomicLoad(&low), atomicLoad(&high));
}`,
      )
    : wgslBlock(
        'stepFoldWgsl(false)',
        [LANES_FOLD_WGSL],
        `fn foldStep(local: u32, span: vec2u) -> vec2u { return foldLanes(local, span); }`,
      )
