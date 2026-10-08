/**
 * The projection the line tests run the real shader text under: the engine's (reversed depth,
 * infinite far: `z = near`, `w = distance`), on a view-space vector, with the image it is seen in.
 */
export const LINE_VIEWPORT = [800, 600]
const NEAR = 0.1,
  FOCAL = 1 / Math.tan(Math.PI / 6)
type Clip = number[]
export const lineProjection = (x: number, y: number, z: number, w: number): Clip => [
  (FOCAL * x * LINE_VIEWPORT[1]) / LINE_VIEWPORT[0],
  FOCAL * y,
  NEAR * w,
  -z,
]
/** A clip position in the image's pixels, from its centre. */
export const toPixels = (c: Clip) => [0, 1].map((i) => (c[i] / c[3]) * 0.5 * LINE_VIEWPORT[i])
