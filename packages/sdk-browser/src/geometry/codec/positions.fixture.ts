/**
 * Input of `positions.test.ts`: the seeded flat-shaded height field that fills a page, each
 * triangle under its own normal.
 */
import type { PageAttributes } from '../../../../sdk-core/src/page/pageInput.ts'
import { xorshiftRandom } from '../../../../math/src/sequence/random.ts'
import { crossVector3 } from '../../../../math/src/vector/vector.ts'

export type Mesh = { indices: number[]; attributes: PageAttributes }

/** A flat-shaded page: 72 triangles of a `7 × 7` height field, each of its own three vertices —
 *  216 of them, under the 256 a page holds — under its face normal, with a texture set and a
 *  colour. */
export function flatMesh(): Mesh {
  const rand = xorshiftRandom(106),
    side = 7
  const step = 0.05 + rand() * 2,
    heights = Array.from({ length: side * side }, () => rand() * 3 - 1.5)
  const corner = (i: number) => [(i % side) * step, heights[i], Math.floor(i / side) * step]
  const grid: number[] = []
  for (let y = 0; y < side - 1; y++)
    for (let x = 0; x < side - 1; x++) {
      const a = y * side + x
      grid.push(a, a + side, a + 1, a + 1, a + side, a + side + 1)
    }
  const positions: number[] = [],
    normals: number[] = []
  for (let t = 0; t < grid.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => corner(grid[t + k]))
    const u = b.map((v, k) => v - a[k]),
      v = c.map((w, k) => w - a[k])
    const n = crossVector3([0, 0, 0], u, v)
    for (const p of [a, b, c]) {
      positions.push(...p)
      normals.push(...n)
    }
  }
  const along = (f: (p: number) => number[], size: number) => ({
    itemSize: size,
    array: new Float32Array(Array.from({ length: positions.length / 3 }, (_, i) => f(i)).flat()),
  })
  const p = (i: number, k: number) => positions[i * 3 + k]
  return {
    indices: grid.map((_, i) => i),
    attributes: {
      POSITION: { itemSize: 3, array: new Float32Array(positions) },
      NORMAL: { itemSize: 3, array: new Float32Array(normals) },
      TEXCOORD_0: along((i) => [p(i, 0) * 0.1, p(i, 2) * 0.1], 2),
      COLOR_0: along((i) => [p(i, 0) * 0.1, p(i, 2) * 0.1, 0.5, 1], 4),
    },
  }
}
