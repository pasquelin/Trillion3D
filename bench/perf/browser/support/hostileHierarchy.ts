// The hostile hierarchies the hierarchy benches share: the poses every one starts its lists with,
// the pick of a node's pose in those lists, and the chains the nodes are laid out in.
import { normalizeQuaternion } from '../../../../packages/math/src/quaternion/quaternion.ts'

/** The scales both hierarchy benches start their hostile lists with: the identity, a mirror on one
 *  axis and on all three, non-uniform scales and a flattened axis. */
export const MIRRORED_SCALES: [number, number, number][] = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, -1],
  [-1, -1, -1],
  [2, 0.5, 3],
  [-2, 3, 0.25],
  [0, 1, 1],
]

/** The extreme scales both hierarchy benches add to `MIRRORED_SCALES`: an axis near the smallest
 *  normal number, and a huge uniform scale. */
export const EXTREME_SCALES: [number, number, number][] = [
  [1e-300, 1, 1],
  [1e150, 1e150, 1e150],
]

/** The rotations both hierarchy benches start their hostile lists with: the identity, a half-turn
 *  (`w = 0`) and a quarter-turn about x. */
export const HOSTILE_ROTATIONS: [number, number, number, number][] = [
  [0, 0, 0, 1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
]

/** An arbitrary unit rotation drawn from `alea`: four draws, normalised. */
export const randomRotation = (alea: () => number): [number, number, number, number] => {
  const q = new Float64Array([alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5])
  return Array.from(normalizeQuaternion(q)) as [number, number, number, number]
}

/** The positions both hierarchy benches start their hostile lists with: the origin, negative
 *  zeros, an ordinary point, extremes. */
export const HOSTILE_POSITIONS: [number, number, number][] = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [1e150, -1e150, 1e-300],
]

/** The pose of chain `k`'s node at `level` in hostile lists: each list walked at its own stride,
 *  so neighbouring nodes mix a position, a rotation and a scale of different kinds. */
export const hostilePose = <P, R, S>(
  lists: { positions: P[]; rotations: R[]; scales: S[] },
  k: number,
  level: number,
): [P, R, S] => [
  lists.positions[(k + level) % lists.positions.length],
  lists.rotations[(k * 3 + level) % lists.rotations.length],
  lists.scales[(k * 7 + level * 5) % lists.scales.length],
]

/**
 * The chains of a hostile hierarchy, in creation order: `chains` chains under roots, chain `k`
 * `k % 6 + 1` deep, then `branches` roots of five children each carrying a chain `branchDepth`
 * deep. `add(parent, k, level)` makes a node under `parent` (−1 for a root) and returns its
 * index; `chained(last, k)` sees each chain's deepest node.
 */
export function hostileChains(
  { chains, branches, branchDepth }: { chains: number; branches: number; branchDepth: number },
  add: (parent: number, k: number, level: number) => number,
  chained?: (last: number, k: number) => void,
) {
  for (let k = 0; k < chains; k++) {
    let parent = -1
    for (let level = 0; level <= k % 6; level++) parent = add(parent, k, level)
    chained?.(parent, k)
  }
  for (let k = 0; k < branches; k++) {
    const branch = add(-1, k, 0)
    for (let child = 0; child < 5; child++) {
      let parent = branch
      for (let level = 1; level <= branchDepth; level++) parent = add(parent, k + child, level)
    }
  }
}
