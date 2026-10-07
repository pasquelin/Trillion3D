import { halton } from '../../../math/src/sequence/halton.ts'
import { TAU } from '../../../math/src/constants.ts'
import { buildTriangleTree } from './triangleTree.ts'

/**
 * Triangle `i` of the collision sweeps: its corners on the unit circle about a Halton centre within
 * 10 m, turned by a Halton angle, tilted by two slopes in [-1, 1]; its tree, flat corners and
 * centre.
 */
export function tiltedTriangle(i: number) {
  const H = (base: number) => halton(i + 1, base)
  const [cx, cy, cz] = [H(2) * 20 - 10, H(3) * 4, H(5) * 20 - 10],
    [tx, tz] = [H(7) * 2 - 1, H(11) * 2 - 1]
  const corners = [0, 1, 2].flatMap((j) => {
    const a = H(13) * TAU + (j * TAU) / 3,
      [x, z] = [Math.cos(a), Math.sin(a)]
    return [cx + x, cy + tx * x + tz * z, cz + z]
  })
  const tree = buildTriangleTree(Float32Array.from(corners))
  return { tree, v: tree.triangles, cx, cy, cz }
}
