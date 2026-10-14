// The camera path of the run-time proxy's motion proof (`motion.gpu.ts`): a case of the generated family
// (`runtimeFamilyCases.ts`) over a mirror floor, its view panned, then dollied, one pose an image.
import { familyCase, type FamilyCase } from './runtimeFamilyCases.ts'

type Vec = [number, number, number]

/** Images of each move: the pan's, then the dolly's. */
export const MOVE_IMAGES = 24
/** The pan's turn an image about the vertical through the eye, in radians: half a degree. */
const PAN_STEP = (0.5 * Math.PI) / 180
/** The dolly's step an image toward the target, as a share of the distance the pan ended at. */
const DOLLY_STEP = 0.012

/** Case `index` of the family over a mirror floor — a metal of roughness 0.02 —, the temporal
 *  accumulation off, so that the reflection target is the trace's alone. Its shapes stand still. */
export function motionCase(index: number): FamilyCase {
  const c = familyCase(index)
  return {
    seed: c.seed,
    shapes: c.shapes,
    floor: { metal: true, roughness: 0.02, albedo: [1, 1, 1] },
    eye: c.eye,
    target: c.target,
    fov: c.fov,
    temporal: false,
  }
}

const posed = (c: FamilyCase, eye: Vec, target: Vec): FamilyCase => ({
  seed: c.seed,
  shapes: c.shapes,
  floor: c.floor,
  eye,
  target,
  fov: c.fov,
  temporal: c.temporal,
})

/** The poses of the path from `c`'s: `MOVE_IMAGES` of the pan, then as many of the dolly. */
export function motionPoses(c: FamilyCase): FamilyCase[] {
  const [ex, ey, ez] = c.eye,
    [tx, ty, tz] = c.target
  const poses: FamilyCase[] = []
  let target: Vec = [tx, ty, tz]
  for (let k = 1; k <= MOVE_IMAGES; k++) {
    const turn = k * PAN_STEP,
      dx = tx - ex,
      dz = tz - ez
    target = [
      ex + dx * Math.cos(turn) - dz * Math.sin(turn),
      ty,
      ez + dx * Math.sin(turn) + dz * Math.cos(turn),
    ]
    poses.push(posed(c, [ex, ey, ez], target))
  }
  const [px, py, pz] = target
  for (let k = 1; k <= MOVE_IMAGES; k++) {
    const s = k * DOLLY_STEP
    poses.push(posed(c, [ex + (px - ex) * s, ey + (py - ey) * s, ez + (pz - ez) * s], target))
  }
  return poses
}
