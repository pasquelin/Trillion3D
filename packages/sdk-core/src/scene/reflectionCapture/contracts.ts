import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  IDENTITY_MATRIX,
  checkMatrix,
  columnLength,
  finiteNumber,
  volumeRefusal,
  type VolumeRefusal,
} from '../volume/objectFields.ts'

/**
 * A REFLECTION CAPTURE (`SceneReflectionCapture`): a place the scene is captured from into a cube, which the
 * surfaces around it read as the light that comes from far away — what a rough surface reflects where neither
 * the screen nor the scene's rays answer it, and the sky light only gives the sky. A capture has a shape, a
 * sphere or a box, that says where it reaches; inside it the cube is read as if the scene it holds were
 * the shape itself (the ray is intersected with the shape, so a reflection moves with the viewer), and it
 * fades out toward the shape's edge so the sky light and the other captures take over there. Where captures
 * overlap, the smallest is read first and lets through what it does not cover (`reflectionCaptureSorted`).
 *
 * Its place is a matrix of its own space to the world's, metres, as the objects of the volume have: its
 * translation is the capture's centre, and for a box the lengths of the columns are the box's half extents
 * (a box of the identity is the cube of two metres on a side) and the columns' directions its axes. A sphere
 * takes its radius from `influenceRadius`, whatever the scale; shear and reflection are left out.
 */

/** The defaults of a reflection capture's fields: the reference's, in metres (3000 and 100 centimetres). */
const REFLECTION_CAPTURE_DEFAULTS = {
  shape: 'sphere',
  influenceRadius: 30,
  boxTransitionDistance: 1,
  brightness: 1,
  captureOffset: [0, 0, 0],
} as const

/** The shapes a capture reaches over. */
const REFLECTION_CAPTURE_SHAPES = ['sphere', 'box'] as const
type ReflectionCaptureShape = (typeof REFLECTION_CAPTURE_SHAPES)[number]

/** The least radius of a sphere, metres: the reference's editor floor of 8 centimetres. */
const LEAST_INFLUENCE_RADIUS = 0.08

/** A reflection capture, as a host declares it. */
export interface SceneReflectionCapture {
  /** Its name; unique among the reflection captures. */
  id: string
  /** What it reaches over: a `'sphere'` (the default) or a `'box'`. */
  shape?: ReflectionCaptureShape
  /** Its place: sixteen numbers, column-major, its own space to the world's, metres. The identity by default. */
  matrix?: readonly number[]
  /** A sphere's radius, metres, at least 0.08 (held to it); 30 by default. A box has none: its extents are its matrix's scale. */
  influenceRadius?: number
  /** A box's transition, metres, 0 or more (held to it): the distance inside its faces over which its cube fades out; 1 by
   *  default. A sphere has none. */
  boxTransitionDistance?: number
  /** The factor the capture's light is multiplied by, 0 or more (held to it); 1 by default. */
  brightness?: number
  /** Where the scene is captured from, relative to the capture's centre, in the world's axes, metres; the centre itself by default.
   *  The cube is read as seen from this point too. */
  captureOffset?: readonly [number, number, number]
}

/** A reflection capture with every field set and held to its range. */
export interface ResolvedReflectionCapture {
  id: string
  shape: ReflectionCaptureShape
  matrix: readonly number[]
  influenceRadius: number
  boxTransitionDistance: number
  brightness: number
  captureOffset: readonly [number, number, number]
}

const refuse: VolumeRefusal = volumeRefusal(
  'INVALID_SCENE_REFLECTION_CAPTURE',
  'reflection capture',
)

/**
 * The reflection capture `capture` declares with every field set and held to its range: the identity placement where
 * it names none, the defaults the rest.
 * @throws EngineError `INVALID_SCENE_REFLECTION_CAPTURE` naming the field that is no finite number, a shape that is
 *   neither, a captureOffset of other than three numbers, or a matrix of sixteen whose columns are all of a length above 0.
 */
export function resolveReflectionCapture(
  capture: SceneReflectionCapture,
): ResolvedReflectionCapture {
  const { id, matrix = IDENTITY_MATRIX } = capture
  if (typeof id !== 'string' || !id) refuse(id, 'id expects a non-empty string')
  checkMatrix(refuse, id, matrix)
  if ([0, 4, 8].some((at) => columnLength(matrix, at) <= 0))
    refuse(id, 'matrix expects columns that are not of length 0')
  const d = REFLECTION_CAPTURE_DEFAULTS
  const given = <K extends keyof typeof d>(name: K): unknown =>
    capture[name] === undefined ? d[name] : capture[name]
  const shape = given('shape')
  if (!REFLECTION_CAPTURE_SHAPES.includes(shape as ReflectionCaptureShape))
    refuse(id, `shape expects ${REFLECTION_CAPTURE_SHAPES.join(' or ')}`)
  const offset = given('captureOffset')
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite))
    refuse(id, 'captureOffset expects three finite numbers')
  return {
    id,
    shape: shape as ReflectionCaptureShape,
    matrix: [...matrix],
    influenceRadius: Math.max(
      finiteNumber(refuse, id, 'influenceRadius', given('influenceRadius')),
      LEAST_INFLUENCE_RADIUS,
    ),
    boxTransitionDistance: Math.max(
      finiteNumber(refuse, id, 'boxTransitionDistance', given('boxTransitionDistance')),
      0,
    ),
    brightness: clamp(finiteNumber(refuse, id, 'brightness', given('brightness')), 0, Infinity),
    captureOffset: [offset[0], offset[1], offset[2]],
  }
}

/** The capture's centre, metres: the translation of its matrix. */
export const reflectionCaptureCentre = (capture: Pick<ResolvedReflectionCapture, 'matrix'>) =>
  [capture.matrix[12], capture.matrix[13], capture.matrix[14]] as const

/** A box's half extents, metres: the lengths of its matrix's columns. */
export const reflectionCaptureScales = (capture: Pick<ResolvedReflectionCapture, 'matrix'>) =>
  [
    columnLength(capture.matrix, 0),
    columnLength(capture.matrix, 4),
    columnLength(capture.matrix, 8),
  ] as const

/** How far the capture reaches from its centre, metres: a sphere's radius; a box's the length of its half extents taken as a
 *  vector, the radius of the sphere that holds it. It orders the captures (`reflectionCaptureSorted`). */
export const reflectionCaptureRadius = (capture: ResolvedReflectionCapture) =>
  capture.shape === 'sphere'
    ? capture.influenceRadius
    : length3(...reflectionCaptureScales(capture))

/** Whether two resolved captures are the same: their numbers. */
export const sameReflectionCapture = (a: ResolvedReflectionCapture, b: ResolvedReflectionCapture) =>
  a.id === b.id &&
  a.shape === b.shape &&
  sameValues(a.matrix, b.matrix) &&
  sameValues(a.captureOffset, b.captureOffset) &&
  a.influenceRadius === b.influenceRadius &&
  a.boxTransitionDistance === b.boxTransitionDistance &&
  a.brightness === b.brightness
