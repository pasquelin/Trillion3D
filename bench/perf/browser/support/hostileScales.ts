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
