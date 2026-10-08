import { MODEL_FLAG } from '../../scene/surfaceModel.ts'

/**
 * The random half of a light-loop test's scope, drawn in one fixed order: a surface normal, each
 * lamp's shadow shade, the cell's list, the thin subsurface and the surface model of `round`. The
 * callers add their own shadow transmission, the one their shader reads.
 */
export function shadedLightScope(
  r: () => number,
  u: (lo: number, hi: number) => number,
  K: object,
  count: number,
  items: object[],
  round: number,
) {
  const n = [u(-1, 1), u(-1, 1), u(-1, 1)],
    ln = Math.hypot(...n) || 1
  const normal = n.map((v) => v / ln)
  const shades = items.map(() => (r() < 0.25 ? 0 : u(0, 1)))
  const scope = {
    ...K,
    directLights: { count, items },
    tileLights: [7, 7, ...[...Array(count).keys()].filter(() => r() < 0.7)],
    thinSubsurface: r() < 0.5 ? [0, 0, 0] : [u(0, 1), u(0, 1), u(0, 1)],
    surfaceModel: [2, MODEL_FLAG.diffuse, MODEL_FLAG.toon][round % 3],
    shadowReceiverOffset: [0, 0, 0],
    shadowReceiverPlane: [0, 0, 0],
    shadowBiasNormal: (vector: number[]) => vector,
    shadowFactor: (slice: number) => (slice < 0 ? 1 : shades[slice]),
  }
  return { normal, scope }
}

/**
 * A random lamp set around a random point `P`, drawn in one fixed order — points, spots and suns in
 * turn, in range and past it, each with the shadow slot `slot` gives it (−1 for none) — and the
 * random scope `shadedLightScope` draws for it next.
 */
export function randomLampScope(
  r: () => number,
  u: (lo: number, hi: number) => number,
  K: Record<string, number>,
  round: number,
  slot: (kind: number, rank: number) => number,
) {
  const count = 1 + Math.floor(u(0, 16))
  const P = [u(-5, 5), u(-1, 3), u(-5, 5)]
  const items = [...Array(count).keys()].map((rank) => {
    const kind = [0, K.KIND_SPOT, K.KIND_SUN][rank % 3]
    return {
      positionRange: [P[0] + u(-4, 4), P[1] + u(-4, 4), P[2] + u(-4, 4), u(0.1, 8)],
      colorIntensity: [u(0, 1), u(0, 1), u(0, 1), u(0, 20)],
      directionCone: [u(-0.5, 0.5), -1, u(-0.5, 0.5), kind === K.KIND_SPOT ? 0.7 : -1],
      params: [kind, slot(kind, rank), 0, kind === K.KIND_SPOT ? 0.9 : 0],
      shape: [u(0, 0.05), 0, 0, 0],
    }
  })
  return { count, P, items, ...shadedLightScope(r, u, K, count, items, round) }
}
