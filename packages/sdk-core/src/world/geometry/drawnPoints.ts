import { crossVector3, normalizeVector3 } from '../../../../math/src/vector/vector.ts'
import { GeometryBuilder } from './builder.ts'

type V3 = [number, number, number]

/** Drawn vertices of one point's octahedron: eight faces of three corners. */
export const POINT_VERTICES = 24

/** An octahedron of radius `r` on every vertex. */
export function points(p: number[], r: number) {
  const b = new GeometryBuilder()
  // prettier-ignore
  const axes: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]
  // prettier-ignore
  for (let v = 0; v + 2 < p.length; v += 3)
    for (const [i, j, k] of [[0, 1, 2], [1, 3, 2], [3, 4, 2], [4, 0, 2], [1, 0, 5], [3, 1, 5], [4, 3, 5], [0, 4, 5]])
      face(b, [axes[i], axes[j], axes[k]].map((a) => [p[v] + a[0] * r, p[v + 1] + a[1] * r, p[v + 2] + a[2] * r] as V3))
  return b
}

/** One triangle with its own vertices, wound outward from the solid it closes. */
function face(b: GeometryBuilder, [a, c, d]: V3[]) {
  const n = normalOf(c.map((x, i) => x - a[i]) as V3, d.map((x, i) => x - a[i]) as V3)
  const first = b.vertex(a, n, [0, 0])
  b.vertex(c, n, [1, 0])
  b.vertex(d, n, [0, 1])
  b.triangle(first, first + 1, first + 2)
}

/** The unit vector along `a × b`. */
const normalOf = (a: V3, b: V3): V3 => {
  const out = crossVector3([0, 0, 0] as V3, a, b)
  normalizeVector3(out)
  return out
}
