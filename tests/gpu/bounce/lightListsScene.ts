// The generated world of the bounce light lists proof (`light-lists.gpu.ts`): a lattice, lights
// over it and points to light.
import { BOUNCE_SETTINGS, type SceneLight } from '../../../packages/sdk-core/src/index.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'

/** The lattice: the cascades' side, 2 m cells, centred on the origin. */
export const SIDE = BOUNCE_SETTINGS.cascadeSize,
  SPACING = 2,
  BASE = -SIDE / 2
/** Points a run reads: a cache sweep's ceiling. */
export const POINTS = BOUNCE_SETTINGS.surfaceTexelsPerFrame

/** `count` lights over the lattice, ranges from 0.5 m to `reach`, spread evenly in log: lamps and
 *  spots, a rectangle, a sun. */
export function lightsOf(count: number, reach: number, r: () => number): SceneLight[] {
  const half = (SIDE * SPACING) / 2
  const at = (): [number, number, number] => [0, 1, 2].map(() => (r() * 2 - 1) * half) as never
  return Array.from({ length: count }, (_, k): SceneLight => {
    const base = {
      id: `l${k}`,
      color: [1, 0.8, 0.6] as [number, number, number],
      intensity: 1 + k,
      castsShadow: false,
    }
    const range = Math.exp(Math.log(0.5) + r() * Math.log(reach / 0.5))
    if (k === 1) return { ...base, kind: 'directional', direction: [0.3, -0.9, 0.2] }
    if (k === 2)
      return {
        ...base,
        kind: 'rect',
        position: at(),
        direction: [0, -1, 0],
        right: [1, 0, 0],
        size: [2, 1],
        range,
      }
    if (k % 3 === 0)
      return { ...base, kind: 'spot', position: at(), direction: [0, -1, 0], coneAngle: 0.6, range }
    return { ...base, kind: 'point', position: at(), range }
  })
}

/** Points inside the lattice, on its cells' faces, and past it; their unit normals. */
export function pointsOf(r: () => number) {
  const words = new Float32Array(POINTS * 8)
  const half = (SIDE * SPACING) / 2
  for (let k = 0; k < POINTS; k++) {
    for (let axis = 0; axis < 3; axis++) {
      let v = (r() * 2 - 1) * half * 1.1
      // A quarter on a cell face: the cell a reader takes there is a rounding's.
      if (k % 4 === 0 && axis === k % 3) v = Math.round(v / SPACING) * SPACING
      words[8 * k + axis] = v
    }
    const n = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1],
      l = length3(n[0], n[1], n[2]) || 1
    for (let axis = 0; axis < 3; axis++) words[8 * k + 4 + axis] = n[axis] / l
  }
  return words
}
