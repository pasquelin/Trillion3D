import type { ClusterCut } from '../selection/math.ts';

/**
 * Per-node bounds of the culling hierarchy, derived once from the clusters it packs.
 *
 * The manifest already carries, per node, the box, a bounding sphere and the subtree's maximum
 * replacement error: enough to reject a subtree whose no cluster still has a stand-in that is too
 * coarse, and nothing more. Deciding a subtree any other way needs three bounds the manifest does
 * not carry: the floor and ceiling of own error, the floor of the stand-in's error, each with the
 * sphere that bounds those it summarises. All are read from the pages: the reduction is done here,
 * at prepare time, once per primitive, without touching the manifest format.
 *
 * Monotonicity, the lot's invariant: a node's bounds enclose those of all its descendants. A
 * ceiling under the threshold therefore holds for every cluster of the subtree, a floor above the
 * threshold too, and the decision taken at the node is word for word the one the descent would
 * have returned.
 */
export const BOUND_STRIDE = 13;
export const OWN_FLOOR = 0,
  OWN_CEIL = 1,
  PARENT_FLOOR = 2,
  OWN_SPHERE = 3,
  PARENT_SPHERE = 7,
  /** 1 when every cluster of the subtree has a producer group. The forcing fallback draws
   *  unconditionally a cluster that nothing produced: a subtree that contains one cannot be
   *  rejected on own error alone. */
  ALL_SOURCED = 11,
  /** 1 when the subtree carries a cluster that NOTHING replaces — the coarsest cover, the one
   *  the pinned fallback draws. Such a subtree is not rejected on own error: the fallback consults
   *  no threshold, and the GPU descent must leave it reachable (`../../gpu/dag/shader/levelWgsl.ts`). The CPU
   *  cut has no use for it: its fallback re-reads the pages without going through the descent
   *  (`repair.ts`). */
  HAS_ROOT = 12;

/** Grows the bounding sphere stored at `at` to cover the one read at `from`.
 *  Negative radius: accumulator still empty. */
/** TypeScript mirror of the incremental sphere merge in `dag/bounds.rs` (Rust compiler): the
 *  same recurrence, two languages, nothing to share between the two code stores. */
function growSphere(into: Float64Array, at: number, sphere: ArrayLike<number>, from: number) {
  const radius = sphere[from + 3];
  if (!(radius >= 0)) return;
  const cx = sphere[from],
    cy = sphere[from + 1],
    cz = sphere[from + 2];
  const held = into[at + 3];
  if (!(held >= 0)) {
    into[at] = cx;
    into[at + 1] = cy;
    into[at + 2] = cz;
    into[at + 3] = radius;
    return;
  }
  const dx = cx - into[at],
    dy = cy - into[at + 1],
    dz = cz - into[at + 2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance + radius <= held) return;
  if (distance + held <= radius) {
    into[at] = cx;
    into[at + 1] = cy;
    into[at + 2] = cz;
    into[at + 3] = radius;
    return;
  }
  const next = (distance + held + radius) * 0.5,
    ratio = (next - held) / distance;
  into[at] += dx * ratio;
  into[at + 1] += dy * ratio;
  into[at + 2] += dz * ratio;
  into[at + 3] = next;
}

/** Folds a cluster into the bounds of its leaf node. */
function foldPage(values: Float64Array, at: number, rec: ClusterCut) {
  const own = rec.lodError,
    sphere = rec.sphere;
  if (own === undefined || own === null) {
    // Cluster with no error band: the node no longer certifies anything, neither accept nor reject.
    values[at + OWN_FLOOR] = 0;
    values[at + OWN_CEIL] = Infinity;
  } else {
    if (own < values[at + OWN_FLOOR]) values[at + OWN_FLOOR] = own;
    // A finite error without a sphere projects to infinity: the ceiling must say so.
    if (own > 0 && !sphere) values[at + OWN_CEIL] = Infinity;
    else if (own > values[at + OWN_CEIL]) values[at + OWN_CEIL] = own;
  }
  if (sphere) growSphere(values, at + OWN_SPHERE, sphere, 0);
  const producer = rec.source;
  if (producer === undefined || producer === null || producer < 0) values[at + ALL_SOURCED] = 0;
  // A cluster that nothing replaces projects to infinity: it lowers no floor.
  const parent = rec.parentError;
  if (parent === undefined || parent === null || !Number.isFinite(parent)) {
    values[at + HAS_ROOT] = 1;
    return;
  }
  if (parent < values[at + PARENT_FLOOR]) values[at + PARENT_FLOOR] = parent;
  const band = rec.parentSphere ?? sphere;
  if (band) growSphere(values, at + PARENT_SPHERE, band, 0);
}

/** Folds a child node into its parent's bounds. */
function foldChild(values: Float64Array, at: number, from: number) {
  if (values[from + OWN_FLOOR] < values[at + OWN_FLOOR])
    values[at + OWN_FLOOR] = values[from + OWN_FLOOR];
  if (values[from + OWN_CEIL] > values[at + OWN_CEIL])
    values[at + OWN_CEIL] = values[from + OWN_CEIL];
  if (values[from + PARENT_FLOOR] < values[at + PARENT_FLOOR])
    values[at + PARENT_FLOOR] = values[from + PARENT_FLOOR];
  growSphere(values, at + OWN_SPHERE, values, from + OWN_SPHERE);
  growSphere(values, at + PARENT_SPHERE, values, from + PARENT_SPHERE);
  if (values[from + ALL_SOURCED] === 0) values[at + ALL_SOURCED] = 0;
  if (values[from + HAS_ROOT] === 1) values[at + HAS_ROOT] = 1;
}

/**
 * Bounds of each node, `BOUND_STRIDE` numbers per node, computed once per primitive. A node's
 * children are always packed after it in the flat array: a single downward sweep is enough to
 * roll the bounds up.
 */
export function cullingBounds(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: readonly ClusterCut[],
) {
  const count = (nodes.length / stride) | 0;
  const values = new Float64Array(count * BOUND_STRIDE);
  for (let node = count - 1; node >= 0; node--) {
    const base = node * stride,
      at = node * BOUND_STRIDE;
    values[at + OWN_FLOOR] = Infinity;
    values[at + OWN_CEIL] = 0;
    values[at + PARENT_FLOOR] = Infinity;
    values[at + OWN_SPHERE + 3] = -1;
    values[at + PARENT_SPHERE + 3] = -1;
    values[at + ALL_SOURCED] = 1;
    values[at + HAS_ROOT] = 0;
    const children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++)
        foldChild(values, at, (first + child) * BOUND_STRIDE);
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++) foldPage(values, at, pages[firstPage + i]);
  }
  return values;
}
