import { EngineError } from '../../contracts/cache.ts'
import type { LinearRgb } from '../../contracts/material.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'

/**
 * A LOCAL FOG VOLUME (`SceneLocalFogVolume`): a sphere of fog placed in the scene, the way a light is
 * — the fog an author puts in a doorway, a valley or a room, whatever the scene's own height fog is.
 * Its medium thins out two ways at once: radially, densest at the sphere's centre and nothing at its
 * surface, and with height, the way the scene's height fog does, along the sphere's own up. What a ray
 * crosses of it is the two laws' coverages multiplied — one minus the transmittance of each —, so that
 * the soft edge of the sphere and the layering of the height show together, and a volume with either
 * extinction at 0 shows nothing. It is lit like the volumetric fog is — the sun, the sky light, its own
 * emissive light — and it lies over the scene's fog; where the scene's fog has a volume, it is
 * voxelised into it (`localFogVolumeInVolume`, `../../contracts/volumetricFogOptions.ts`).
 *
 * It is not an object of the volume material domain (`../volume/contracts.ts`, `addFogVolume`): that one
 * voxelises a box or a sphere with a material of its own into the volume only; this one is a medium
 * with its own law, drawn where the volume is not too.
 *
 * Its place is a matrix of its own space to the world's, metres, as the objects of the volume have:
 * where its origin lies is the sphere's centre, its second column is the sphere's up — the height
 * the height law is measured along, the rest of its rotation changes nothing — and the largest of the
 * columns' lengths scales it: the sphere's radius is five metres times that scale. The translation,
 * the rotation and the scale are those of the matrix as a transform; shear and reflection are left out.
 */

/** The radius of a local fog volume whose matrix has a scale of 1, metres: five, 500 centimetres of
 *  the engines that fixed the volume. */
const LOCAL_FOG_BASE_RADIUS = 5

/** The defaults of a local fog volume's fields. */
const LOCAL_FOG_DEFAULTS = {
  radialDensity: 1,
  heightDensity: 1,
  heightFalloff: 1000,
  heightOffset: 0,
  scatteringDistribution: 0.2,
  albedo: [1, 1, 1],
  emissive: [0, 0, 0],
  startDistance: 0,
  sortPriority: 0,
} as const

/** The range of the scattering distribution, the phase function's `g`: the engines that fixed it
 *  stop short of 1, where the function is infinite. */
const LOCAL_FOG_DISTRIBUTION_RANGE = [0, 0.999] as const
/** The range of the sort priority: a whole number. */
const LOCAL_FOG_PRIORITY_RANGE = [-127, 127] as const
/** The least falloff: below it the density near the horizon of the sphere shows artefacts. */
const LOCAL_FOG_LEAST_FALLOFF = 1
/** The most a colour's channel is held to: what a 32-bit float keeps of the engines' 10³⁸. */
const LARGEST = 1e38

/** A local fog volume, as a host declares it. */
export interface SceneLocalFogVolume {
  /** Its name; unique among the local fog volumes. */
  id: string
  /** Its place: sixteen numbers, column-major, its own space to the world's, metres. The identity by
   *  default. */
  matrix?: readonly number[]
  /** The extinction of the radial fog at the sphere's centre, per metre, 0 or more (held to it); 1 by
   *  default. With 0 the volume shows nothing: the radial and the height coverages multiply. */
  radialDensity?: number
  /** The extinction of the height fog at the sphere's height 0, per metre, 0 or more (held to it); 1 by
   *  default. With 0 the volume shows nothing, the coverages multiplying, and `heightFalloff` and
   *  `heightOffset` mean nothing. */
  heightDensity?: number
  /** How the height fog's density falls off with the sphere's height, 1 or more (held to it): the
   *  density is `heightDensity · e^(−falloff / 100 · height)`, the height in the sphere's units — 1 is
   *  the sphere's radius — so a larger falloff makes a thinner transition; 1000 by default. */
  heightFalloff?: number
  /** The height the height fog's density is `heightDensity` at, in the sphere's units; 0 by default. */
  heightOffset?: number
  /** The phase function's `g`, how the medium scatters the light toward the eye: 0 equally in every
   *  direction, toward 1 forward, in [0, 0.999] (held to it); 0.2 by default. */
  scatteringDistribution?: number
  /** The share of the light each channel scatters, linear, in [0, 1] (held to it); white by default. */
  albedo?: LinearRgb
  /** The light the medium gives off, a luminance, linear, 0 or more (held to it); black by default.
   *  It follows the medium's coverage. */
  emissive?: LinearRgb
  /** The distance from the eye, metres, before which the volume does not show, 0 or more (held to it);
   *  0 by default. The run's own start distance (`localFogVolumeStartDistance`) holds it above that. */
  startDistance?: number
  /** Overrides the order by distance: a volume of a lower priority is drawn behind one of a higher,
   *  a whole number in [-127, 127] (held to it); 0 by default. */
  sortPriority?: number
}

/** A local fog volume with every field set and held to its range. */
export interface ResolvedLocalFogVolume {
  id: string
  matrix: readonly number[]
  radialDensity: number
  heightDensity: number
  heightFalloff: number
  heightOffset: number
  scatteringDistribution: number
  albedo: LinearRgb
  emissive: LinearRgb
  startDistance: number
  sortPriority: number
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const

function refuse(id: unknown, message: string): never {
  throw new EngineError(
    'INVALID_SCENE_LOCAL_FOG_VOLUME',
    `local fog volume ${String(id)}: ${message}`,
    {
      id,
    },
  )
}

/** A finite number, else refused by `name`. */
function finite(id: string, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    refuse(id, `${name} expects a finite number`)
  return value
}

/** A colour of three finite numbers, held to `[0, most]`. */
function colour(id: string, name: string, value: unknown, most: number): LinearRgb {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    refuse(id, `${name} expects three finite numbers`)
  return value.map((c) => clamp(c, 0, most)) as unknown as LinearRgb
}

/** The length of a column of `matrix`. */
const columnLength = (matrix: readonly number[], at: number) =>
  length3(matrix[at], matrix[at + 1], matrix[at + 2])

/**
 * The local fog volume `volume` declares with every field set and held to its range (the ranges the
 * fields name): the identity placement where it names none, the defaults the rest.
 * @throws EngineError `INVALID_SCENE_LOCAL_FOG_VOLUME` naming the field that is no finite number, a
 *   colour of three, or a matrix of sixteen whose columns are all of a length above 0.
 */
export function resolveLocalFogVolume(volume: SceneLocalFogVolume): ResolvedLocalFogVolume {
  const { id, matrix = IDENTITY } = volume
  if (typeof id !== 'string' || !id) refuse(id, 'id expects a non-empty string')
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite))
    refuse(id, 'matrix expects sixteen finite numbers')
  if ([0, 4, 8].some((at) => columnLength(matrix, at) <= 0))
    refuse(id, 'matrix expects columns that are not of length 0')
  const d = LOCAL_FOG_DEFAULTS
  // A field left out (undefined) is the default; one that is not a number is refused, null included.
  const given = <K extends keyof typeof d>(name: K): unknown =>
    volume[name] === undefined ? d[name] : volume[name]
  const number = (name: keyof typeof d, least: number, most = Infinity) =>
    clamp(finite(id, name, given(name)), least, most)
  return {
    id,
    matrix: [...matrix],
    radialDensity: number('radialDensity', 0),
    heightDensity: number('heightDensity', 0),
    heightFalloff: number('heightFalloff', LOCAL_FOG_LEAST_FALLOFF),
    heightOffset: number('heightOffset', -Infinity),
    scatteringDistribution: number('scatteringDistribution', ...LOCAL_FOG_DISTRIBUTION_RANGE),
    albedo: colour(id, 'albedo', given('albedo'), 1),
    emissive: colour(id, 'emissive', given('emissive'), LARGEST),
    startDistance: number('startDistance', 0),
    sortPriority: Math.round(number('sortPriority', ...LOCAL_FOG_PRIORITY_RANGE)),
  }
}

/** The sphere's radius, metres: the base radius times the largest of the matrix's columns. */
export const localFogRadius = (volume: Pick<ResolvedLocalFogVolume, 'matrix'>) =>
  LOCAL_FOG_BASE_RADIUS *
  Math.max(
    columnLength(volume.matrix, 0),
    columnLength(volume.matrix, 4),
    columnLength(volume.matrix, 8),
  )

/** Whether two resolved volumes are the same: their numbers. */
export const sameLocalFogVolume = (a: ResolvedLocalFogVolume, b: ResolvedLocalFogVolume) =>
  a.id === b.id &&
  sameValues(a.matrix, b.matrix) &&
  sameValues(a.albedo, b.albedo) &&
  sameValues(a.emissive, b.emissive) &&
  a.radialDensity === b.radialDensity &&
  a.heightDensity === b.heightDensity &&
  a.heightFalloff === b.heightFalloff &&
  a.heightOffset === b.heightOffset &&
  a.scatteringDistribution === b.scatteringDistribution &&
  a.startDistance === b.startDistance &&
  a.sortPriority === b.sortPriority
