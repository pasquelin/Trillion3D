type Vec3 = readonly [number, number, number]

/** The basis of a shadow face: where it looks from and the unit axes it looks along (forward) and across (right, up). */
export interface FaceBasis {
  readonly origin: Vec3
  readonly forward: Vec3
  readonly right: Vec3
  readonly up: Vec3
}

/**
 * The matrix, column-major, from a shadow map's texel space to the world, as the render of a volumetric shadow map reads it: a point
 * `(u, v, z, 1)` with `(u, v)` the place on the face from 0 to 1 (v down) and `z` 1 at the near plane, 0 at the far, is the world point of
 * the homogeneous result over its fourth coordinate. The ray of a texel runs from its image at z = 1 to its image at z = 0.
 *
 * A perspective face: a point at depth `d` along `forward` is `origin + (forward + right * sx * x + up * sy * y) * d` with `x = 2u - 1` and
 * `y = 1 - 2v`, `sx` and `sy` the tangents of the half angles; `1 / d` is linear in `z` and gives `near` at z = 1 and `far` at z = 0.
 */
export function perspectiveShadowToWorld(
  basis: FaceBasis,
  scale: readonly [number, number],
  near: number,
  far: number,
): Float64Array {
  const { origin, forward, right, up } = basis
  const a = 1 / near - 1 / far
  const b = 1 / far
  const m = new Float64Array(16)
  for (let i = 0; i < 3; i++) {
    m[i] = 2 * scale[0] * right[i]
    m[4 + i] = -2 * scale[1] * up[i]
    m[8 + i] = origin[i] * a
    m[12 + i] = origin[i] * b + forward[i] - scale[0] * right[i] + scale[1] * up[i]
  }
  m[11] = a
  m[15] = b
  return m
}

/**
 * An orthographic face: a box `radius` to each side of `origin` across, `length` deep along `forward`, the near plane at the origin's
 * plane (z = 1) and the far `length` beyond it (z = 0).
 */
export function orthographicShadowToWorld(
  basis: FaceBasis,
  radius: number,
  length: number,
): Float64Array {
  const { origin, forward, right, up } = basis
  const m = new Float64Array(16)
  for (let i = 0; i < 3; i++) {
    m[i] = 2 * radius * right[i]
    m[4 + i] = -2 * radius * up[i]
    m[8 + i] = -length * forward[i]
    m[12 + i] = origin[i] - radius * right[i] + radius * up[i] + length * forward[i]
  }
  m[15] = 1
  return m
}

/** The world point a matrix gives `(u, v, z, 1)`, after the division by its fourth coordinate. */
export function shadowPointToWorld(
  m: ArrayLike<number>,
  u: number,
  v: number,
  z: number,
): [number, number, number] {
  const at = (r: number) => m[r] * u + m[4 + r] * v + m[8 + r] * z + m[12 + r]
  const w = at(3)
  return [at(0) / w, at(1) / w, at(2) / w]
}

/**
 * The basis of a face of the Beer shadow map of a light (`beerBasis`, `beerShadowMapWgsl.ts`): a directional light looks along its direction from the
 * back of the sphere that holds the volumes (`sphere`, centre and radius), a local light from its position along the axis of the face (-x, +x, -y, +y,
 * -z, +z); the right axis is the cross product of a reference (up, or z where the face looks along y) with the forward one, the up axis the
 * cross product of forward and right. The map's rays, in the building and in the reading, are made from this basis.
 */
export function beerFaceBasis(
  light: { directional: boolean; position: Vec3; direction: Vec3 },
  face: number,
  sphere: readonly [number, number, number, number],
): FaceBasis {
  let forward: Vec3
  let origin: Vec3
  if (light.directional) {
    const length = Math.hypot(...light.direction) || 1
    forward = [
      light.direction[0] / length,
      light.direction[1] / length,
      light.direction[2] / length,
    ]
    origin = [0, 1, 2].map((i) => sphere[i] - forward[i] * sphere[3]) as unknown as Vec3
  } else {
    const sign = face & 1 ? 1 : -1
    const axis = face >> 1
    forward = [axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0]
    origin = light.position
  }
  const reference: Vec3 = Math.abs(forward[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const side = cross(reference, forward)
  const sideLength = Math.hypot(...side) || 1
  const right: Vec3 = [side[0] / sideLength, side[1] / sideLength, side[2] / sideLength]
  return { origin, forward, right, up: cross(forward, right) }
}
