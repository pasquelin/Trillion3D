// The reflection proof's frame, computed analytically: an eye at the origin looking down -z through
// an infinite reversed perspective (60° vertically), a mirror floor at y = -1, an emissive quad
// standing on it at z = -6 (|x| ≤ ½, -1 ≤ y ≤ 1). Each pixel's ray, through its centre, meets the
// quad, the floor or nothing: its depth (near / distance, 0 for nothing), its surface flag (the
// floor a lit standard surface, the quad a diffuse one, which reflects nothing), its normal and
// roughness, and the lit colour the image holds there.
import { camera } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { paintPixel, rigFrameOf, type RigFrame } from './rigFrame.ts'
import { TAU } from '../../../packages/math/src/constants.ts'

export const MIRROR = {
  size: 128,
  near: 0.1,
  /** The quad's lit colour, and the floor's own. */
  quad: [1, 0.25, 0],
  floor: [0.05, 0.05, 0.05],
}

/** The eye of the frame: at the origin, looking down -z, 60° vertically. */
const eye = () => camera([0, 0, 0], [0, 0, -1], MIRROR.size, MIRROR.size, TAU / 6, MIRROR.near)

/** The frame: its floor a metal of roughness `rough` (polished by default), white and of metalness
 *  one, so that the share is the lobe's own weight. */
export function mirrorScene(rough = 0): RigFrame {
  const { size, quad, floor } = MIRROR
  const view = eye()
  const frame = rigFrameOf([size, size], view.m, [0, 0, 0])
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const at = py * size + px
      // The eye ray through the pixel's centre, scaled to a unit distance along -z.
      const d = view.ray(px + 0.5, py + 0.5)
      const ray = d.map((c) => c / -d[2])
      const onQuad = Math.abs(ray[0] * 6) <= 0.5 && Math.abs(ray[1] * 6) <= 1
      const onFloor = !onQuad && ray[1] < 0
      if (!onQuad && !onFloor) continue
      frame.depth[at] = view.depthOf(d, onQuad ? 6 / -d[2] : -1 / d[1])
      paintPixel(frame, at, !onQuad, onQuad ? [0, 0, 1] : [0, 1, 0], onQuad ? quad : floor, rough)
    }
  return frame
}

/** The pixel the floor shows the quad's point `(x, y, -6)` at: the eye's ray to its mirror image
 *  `(x, -2 - y, -6)` crosses the floor where it does. */
export function reflectedPixel(x: number, y: number) {
  const t = 1 / (2 + y)
  const [px, py] = eye().project([x * t, -1, -6 * t])
  return [Math.floor(px), Math.floor(py)]
}
