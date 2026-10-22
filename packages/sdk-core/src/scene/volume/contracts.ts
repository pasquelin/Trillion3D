import { EngineError } from '../../contracts/cache.ts'
import {
  resolveVolumeMaterial,
  type VolumeMaterial,
  type VolumeMaterialOptions,
} from '../../contracts/volumeMaterial.ts'

/**
 * AN OBJECT VOXELISED INTO THE FOG'S VOLUME (`SceneFogVolume`): a placed box of space whose
 * material (`VolumeMaterial`) adds to the medium of every cell it covers. A mesh whose material
 * is of the volume domain is one (`../../world/material/index.ts`); a host declares one too
 * (`addFogVolume`).
 *
 * `shape` says how it covers the cells: a `box` is the oriented box `boundsMin`…`boundsMax` of its
 * own space placed by `matrix` — the way a mesh is voxelised —, a `sphere` is the sphere around
 * that box — the way a particle is. The slices it reaches are always those of the sphere around
 * the box.
 */

/** The shapes an object may cover the cells with. */
export const FOG_VOLUME_SHAPES = ['box', 'sphere'] as const
/** How an object covers the cells. */
type FogVolumeShape = (typeof FOG_VOLUME_SHAPES)[number]
/** What a vector of three numbers is. */
type Vec3 = readonly [number, number, number]

/** An object voxelised into the volume, as a host declares it. */
export interface SceneFogVolume {
  /** Its name; unique among the volume objects. */
  id: string
  /** `box` by default. */
  shape?: FogVolumeShape
  /** Its place: sixteen numbers, column-major, its own space to the world's, metres. The identity
   *  by default. */
  matrix?: readonly number[]
  /** The corners of its box in its own space, metres: `[-0.5, -0.5, -0.5]` and `[0.5, 0.5, 0.5]` by
   *  default. */
  boundsMin?: Vec3
  boundsMax?: Vec3
  /** What it adds to the medium. */
  material?: VolumeMaterialOptions
}

/** An object with every field set and held to its range. */
export interface ResolvedFogVolume {
  id: string
  shape: FogVolumeShape
  matrix: readonly number[]
  boundsMin: Vec3
  boundsMax: Vec3
  material: VolumeMaterial
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const

function refuse(id: unknown, message: string): never {
  throw new EngineError('INVALID_SCENE_FOG_VOLUME', `fog volume ${String(id)}: ${message}`, { id })
}

function vector(id: string, name: string, value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    refuse(id, `${name} expects three finite numbers`)
  return [value[0], value[1], value[2]]
}

/**
 * The object `volume` declares with every field set: the shape `box`, the identity placement and
 * the box of a metre around the origin where it names none, the box's corners in order, the
 * material resolved (`resolveVolumeMaterial`).
 * @throws EngineError `INVALID_SCENE_FOG_VOLUME` naming the field that is not what it expects.
 */
export function resolveFogVolume(volume: SceneFogVolume): ResolvedFogVolume {
  const { id, shape = 'box', matrix = IDENTITY } = volume
  if (typeof id !== 'string' || !id) refuse(id, 'id expects a non-empty string')
  if (!FOG_VOLUME_SHAPES.includes(shape))
    refuse(id, `shape expects ${FOG_VOLUME_SHAPES.join(' or ')}`)
  if (matrix.length !== 16 || !matrix.every(Number.isFinite))
    refuse(id, 'matrix expects sixteen finite numbers')
  const a = vector(id, 'boundsMin', volume.boundsMin ?? [-0.5, -0.5, -0.5])
  const b = vector(id, 'boundsMax', volume.boundsMax ?? [0.5, 0.5, 0.5])
  return {
    id,
    shape,
    matrix: [...matrix],
    boundsMin: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    boundsMax: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    material: resolveVolumeMaterial(volume.material),
  }
}
