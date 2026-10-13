/**
 * Where the ray `origin + t·direction` meets the triangle at `v[at..at + 9]`, either face, for
 * `near < t < far`: its parameter `t`, or `far` when it misses — a determinant of the edges and
 * the ray under `1e-12` (a ray in the triangle's plane, a degenerate triangle) or a hit outside the
 * triangle or the range. The Möller–Trumbore form, term by term and in the order of `ray_triangle`
 * of `packages/math/rust/src/triangle.rs`; `rayTriangleDistance` of `./../wgsl/geometry.ts` is its
 * shader twin (`packages/math/golden/ray_triangle.json`).
 */
export function rayTriangle(
  origin: ArrayLike<number>,
  direction: ArrayLike<number>,
  v: ArrayLike<number>,
  at: number,
  near: number,
  far: number,
) {
  const ax = v[at],
    ay = v[at + 1],
    az = v[at + 2]
  const e0x = v[at + 3] - ax,
    e0y = v[at + 4] - ay,
    e0z = v[at + 5] - az
  const e1x = v[at + 6] - ax,
    e1y = v[at + 7] - ay,
    e1z = v[at + 8] - az
  const dx = direction[0],
    dy = direction[1],
    dz = direction[2]
  const px = dy * e1z - dz * e1y,
    py = dz * e1x - dx * e1z,
    pz = dx * e1y - dy * e1x
  const determinant = e0x * px + e0y * py + e0z * pz
  if (Math.abs(determinant) < 1e-12) return far
  const inverse = 1 / determinant
  const ox = origin[0] - ax,
    oy = origin[1] - ay,
    oz = origin[2] - az
  const u = (ox * px + oy * py + oz * pz) * inverse
  if (!(u >= 0 && u <= 1)) return far
  const cx = oy * e0z - oz * e0y,
    cy = oz * e0x - ox * e0z,
    cz = ox * e0y - oy * e0x
  const w = (dx * cx + dy * cy + dz * cz) * inverse
  if (w < 0 || u + w > 1) return far
  const distance = (e1x * cx + e1y * cy + e1z * cz) * inverse
  return distance <= near || distance >= far ? far : distance
}
