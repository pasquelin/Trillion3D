import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { Object3D } from '../../world/object/object3d.ts'
import {
  IDENTITY_MATRIX,
  checkMatrix,
  columnLength,
  finiteNumber,
  volumeRefusal,
  type VolumeRefusal,
} from '../volume/objectFields.ts'

/**
 * A PLANAR REFLECTION (`ScenePlanarReflection`): a mirror the scene is drawn in again. The scene is drawn from the main view's camera
 * reflected across the plane (a view of its own, clipped to what lies on the viewer's side of the plane), and the surfaces that stand
 * near the plane and face it read that image as their reflection, in place of the screen's and the environment's: sharp, exact for a
 * flat floor, water or window. The plane is the local XZ plane of the object's place, its normal the local +y; the object reaches 20
 * metres along its local x and z (times the lengths of those columns) and the fade-out distance along its normal, past which a
 * surface reads nothing of it.
 *
 * Its place is a matrix of its own space to the world's, metres, as the objects of the volume have: the translation is a point of the
 * plane, the direction of the second column its normal (it faces the viewer on that side), the lengths of the first and third
 * columns the factors of the 20 metres. Shear is left out.
 */

/** The defaults of a planar reflection's fields: the reference's, in metres (500, 10000, 60 and 100 centimetres). */
const PLANAR_REFLECTION_DEFAULTS = {
  normalDistortionStrength: 5,
  prefilterRoughness: 0.01,
  prefilterRoughnessDistance: 100,
  screenPercentage: 50,
  extraFov: 0,
  distanceFromPlaneFadeoutStart: 0.6,
  distanceFromPlaneFadeoutEnd: 1,
  angleFromPlaneFadeStart: 20,
  angleFromPlaneFadeEnd: 30,
} as const

/** How far a planar reflection reaches along its local x and z before the lengths of those columns, metres: the reference's mesh extent. */
export const PLANAR_REFLECTION_EXTENT = 20

/** A planar reflection, as a host declares it. */
export interface ScenePlanarReflection {
  /** Its name; unique among the planar reflections. */
  id: string
  /** Its place: sixteen numbers, column-major, its own space to the world's, metres. The identity by default (the plane y = 0, facing up). */
  matrix?: readonly number[]
  /** How far along the mirrored reflection direction the image is read, metres, 0 or more (held to it); 5 by default: the larger, the more the
   *  surface's normal distorts the image. */
  normalDistortionStrength?: number
  /** The roughness the image is blurred with to hide its low resolution, from 0 to 0.04 (held to it); 0.01 by default. Larger values cost more. */
  prefilterRoughness?: number
  /** The distance of the reflected surface, metres, at which the blur reaches the prefilter roughness; 100 by default. */
  prefilterRoughnessDistance?: number
  /** The size of the image as a percentage of the main view's, from 25 to 100 (held to it); 50 by default. */
  screenPercentage?: number
  /** The field the image is drawn with beyond the main view's, degrees, 0 or more (held to it); 0 by default. It keeps the normal distortion from reading outside the image. */
  extraFov?: number
  /** The distance from the plane, metres, at which a surface starts to fade out its reflection, 0 or more (held to it); 0.6 by default. */
  distanceFromPlaneFadeoutStart?: number
  /** The distance from the plane, metres, at which a surface's reflection has faded out, 0 or more (held to it); 1 by default. */
  distanceFromPlaneFadeoutEnd?: number
  /** The angle between a surface's normal and the plane's, degrees, from 0.1 to 89.9 (held to it), at which its reflection starts to fade out; 20 by default. */
  angleFromPlaneFadeStart?: number
  /** The angle between a surface's normal and the plane's, degrees, from 0.1 to 89.9 (held to it), at which its reflection has faded out; 30 by default. */
  angleFromPlaneFadeEnd?: number
  /** The objects the mirrored view does not draw, each with everything under it (the water plane itself, usually); none by default. */
  hidden?: readonly Object3D[]
}

/** A planar reflection with every field set and held to its range. */
export interface ResolvedPlanarReflection {
  id: string
  matrix: readonly number[]
  normalDistortionStrength: number
  prefilterRoughness: number
  prefilterRoughnessDistance: number
  screenPercentage: number
  extraFov: number
  distanceFromPlaneFadeoutStart: number
  distanceFromPlaneFadeoutEnd: number
  angleFromPlaneFadeStart: number
  angleFromPlaneFadeEnd: number
  hidden: readonly Object3D[]
}

const refuse: VolumeRefusal = volumeRefusal('INVALID_SCENE_PLANAR_REFLECTION', 'planar reflection')

/**
 * The planar reflection `reflection` declares with every field set and held to its range: the identity placement where it names none, the
 * defaults the rest.
 * @throws EngineError `INVALID_SCENE_PLANAR_REFLECTION` naming the field that is no finite number, a hidden list that is no list, or a matrix of
 *   sixteen whose columns are not all of a length above 0.
 */
export function resolvePlanarReflection(
  reflection: ScenePlanarReflection,
): ResolvedPlanarReflection {
  const { id, matrix = IDENTITY_MATRIX, hidden = [] } = reflection
  if (typeof id !== 'string' || !id) refuse(id, 'id expects a non-empty string')
  checkMatrix(refuse, id, matrix)
  if ([0, 4, 8].some((at) => columnLength(matrix, at) <= 0))
    refuse(id, 'matrix expects columns that are not of length 0')
  if (!Array.isArray(hidden)) refuse(id, 'hidden expects a list of objects')
  const d = PLANAR_REFLECTION_DEFAULTS
  const given = <K extends keyof typeof d>(name: K): number =>
    finiteNumber(refuse, id, name, reflection[name] === undefined ? d[name] : reflection[name])
  return {
    id,
    matrix: [...matrix],
    normalDistortionStrength: Math.max(given('normalDistortionStrength'), 0),
    prefilterRoughness: clamp(given('prefilterRoughness'), 0, 0.04),
    prefilterRoughnessDistance: given('prefilterRoughnessDistance'),
    screenPercentage: clamp(given('screenPercentage'), 25, 100),
    extraFov: Math.max(given('extraFov'), 0),
    distanceFromPlaneFadeoutStart: Math.max(given('distanceFromPlaneFadeoutStart'), 0),
    distanceFromPlaneFadeoutEnd: Math.max(given('distanceFromPlaneFadeoutEnd'), 0),
    angleFromPlaneFadeStart: clamp(given('angleFromPlaneFadeStart'), 0.1, 89.9),
    angleFromPlaneFadeEnd: clamp(given('angleFromPlaneFadeEnd'), 0.1, 89.9),
    hidden: [...hidden],
  }
}

/** Whether two resolved planar reflections are the same: their numbers and the very objects they hide. */
export const samePlanarReflection = (a: ResolvedPlanarReflection, b: ResolvedPlanarReflection) =>
  a.id === b.id &&
  sameValues(a.matrix, b.matrix) &&
  a.normalDistortionStrength === b.normalDistortionStrength &&
  a.prefilterRoughness === b.prefilterRoughness &&
  a.prefilterRoughnessDistance === b.prefilterRoughnessDistance &&
  a.screenPercentage === b.screenPercentage &&
  a.extraFov === b.extraFov &&
  a.distanceFromPlaneFadeoutStart === b.distanceFromPlaneFadeoutStart &&
  a.distanceFromPlaneFadeoutEnd === b.distanceFromPlaneFadeoutEnd &&
  a.angleFromPlaneFadeStart === b.angleFromPlaneFadeStart &&
  a.angleFromPlaneFadeEnd === b.angleFromPlaneFadeEnd &&
  a.hidden.length === b.hidden.length &&
  a.hidden.every((object, at) => object === b.hidden[at])
