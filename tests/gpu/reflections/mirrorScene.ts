// The reflection proof's frame, computed analytically: an eye at the origin looking down -z through
// an infinite reversed perspective (60° vertically), a mirror floor at y = -1, an emissive quad
// standing on it at z = -6 (|x| ≤ ½, -1 ≤ y ≤ 1). Each pixel's ray, through its centre, meets the
// quad, the floor or nothing: its depth (near / distance, 0 for nothing), its surface flag (the
// floor a lit standard surface, the quad a diffuse one, which reflects nothing), its normal and
// roughness, and the lit colour the image holds there.
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
export const MIRROR = {
  size: 128,
  near: 0.1,
  /** The quad's lit colour, and the floor's own. */
  quad: [1, 0.25, 0, 1],
  floor: [0.05, 0.05, 0.05, 1],
}
/** The surface flags of the frame (`scene/surfaceModel.ts`): lit standard, diffuse. */
const STANDARD = 2,
  DIFFUSE = 4

export function mirrorScene() {
  const { size, near, quad, floor } = MIRROR
  const f = 1 / perspectiveSlope(60)
  // Column-major: x and y scaled by f, clip z the near plane, clip w the distance along -z.
  const viewProjection = new Float64Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0])
  const depth = new Float32Array(size * size),
    flags = new Uint8Array(size * size),
    normals = new Float32Array(size * size * 4),
    radiance = new Float32Array(size * size * 4)
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const at = py * size + px
      // The ray through the pixel's centre, at a unit distance along -z.
      const dx = ((px + 0.5) / size) * 2 - 1,
        dy = 1 - ((py + 0.5) / size) * 2
      const ray = [dx / f, dy / f, -1]
      const onQuad = Math.abs(ray[0] * 6) <= 0.5 && Math.abs(ray[1] * 6) <= 1
      const onFloor = !onQuad && ray[1] < 0
      if (!onQuad && !onFloor) continue
      const distance = onQuad ? 6 : -1 / ray[1]
      depth[at] = near / distance
      flags[at] = onQuad ? DIFFUSE : STANDARD
      normals.set(onQuad ? [0, 0, 1, 1] : [0, 1, 0, 0], at * 4)
      radiance.set(onQuad ? quad : floor, at * 4)
    }
  return { viewProjection, depth, flags, normals, radiance }
}

/** The pixel the floor shows the quad's point `(x, y, -6)` at: the eye's ray to its mirror image
 *  `(x, -2 - y, -6)` crosses the floor where it does. */
export function reflectedPixel(x: number, y: number) {
  const { size } = MIRROR
  const f = 1 / perspectiveSlope(60)
  const image = [x, -2 - y, -6]
  const t = -1 / image[1]
  const point = image.map((c) => c * t)
  const ndc = [(f * point[0]) / -point[2], (f * point[1]) / -point[2]]
  return [Math.floor((ndc[0] * 0.5 + 0.5) * size), Math.floor((0.5 - ndc[1] * 0.5) * size)]
}
