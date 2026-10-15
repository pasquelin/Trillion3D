import { length3 } from '../../../math/src/vector/vector.ts'
import { sphereFromBoundsBatch } from '../../../math/src/batch/culling.ts'

/** Perspective framing from a bounding-sphere radius. `near` scales with the asset; there is no absolute centimetre floor. */
export function framingFromBounds(radius: number, aspect: number) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty scene bounds')
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid aspect')
  const near = radius / 10000,
    far = radius * 20,
    scale = (radius * 1.9) / Math.min(1, aspect),
    len = length3(0.85, 0.65, 1)
  return {
    near,
    far,
    offset: [(0.85 * scale) / len, (0.65 * scale) / len, (1 * scale) / len] as [
      number,
      number,
      number,
    ],
  }
}

/**
 * THE ONE FRAMING OF A BOX: the view of `flat` (min x, y, z, max x, y, z) for a picture of
 * `aspect` — target its centre, eye at the framing's offset from it, along `direction` when one is
 * given, at the same distance. Its sphere is the core's (`sphereFromBoundsBatch`: midpoint and
 * half-diagonal). One empty-box rule: an empty box frames the unit box about the origin, written
 * into `flat` — the box the view frames.
 */
export function frameBounds(
  flat: Float64Array,
  aspect: number,
  direction?: readonly [number, number, number],
) {
  const sphere = new Float64Array(4)
  sphereFromBoundsBatch(sphere, flat, 1)
  if (!(sphere[3] > 0)) {
    flat.set([-1, -1, -1, 1, 1, 1])
    sphereFromBoundsBatch(sphere, flat, 1)
  }
  const radius = sphere[3],
    framing = framingFromBounds(radius, aspect),
    [ox, oy, oz] = framing.offset
  const along = direction ?? framing.offset,
    scale = length3(ox, oy, oz) / length3(along[0], along[1], along[2])
  const centre: [number, number, number] = [sphere[0], sphere[1], sphere[2]]
  return {
    centre,
    radius,
    near: framing.near,
    far: framing.far,
    position: [0, 1, 2].map((i) => centre[i] + along[i] * scale) as [number, number, number],
  }
}
