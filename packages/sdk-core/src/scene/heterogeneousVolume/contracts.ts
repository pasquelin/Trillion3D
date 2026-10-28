import type { MaterialGraph } from '../../world/material/graph/api.ts'
import { volumeGraphFields } from '../volume/contracts.ts'
import {
  IDENTITY_MATRIX,
  checkMatrix,
  volumeRefusal,
  type VolumeRefusal,
} from '../volume/objectFields.ts'

/**
 * A HETEROGENEOUS VOLUME (`SceneHeterogeneousVolume`): a placed volume whose medium is a sparse
 * volume texture the compiler wrote (`sparseVolumes.bin`, a node of the scene that cites a `.vdb`
 * file), read by the sample in place of the fog's constant box (`../volume/contracts.ts`). Its
 * fields are the reference component's (`HeterogeneousVolumeComponent.h:20-84`, defaults
 * `HeterogeneousVolumeComponent.cpp:247-275`): its place, the frame it plays or the animation that
 * picks it, the streaming bias, whether it pivots at its centroid, the step factors of its march
 * and of its shadows, and the downsample of its lighting.
 */

/** What a vector of three numbers is. */
type Vec3 = readonly [number, number, number]

/** A heterogeneous volume, as a host declares it. */
export interface SceneHeterogeneousVolume {
  /** Its name; unique among the heterogeneous volumes. */
  id: string
  /** The node of the compiled scene that cites the volume (`TRILLION3D_sparse_volume`). */
  source: number
  /** Its place: sixteen numbers, column-major, its own space to the world's, metres. The identity
   *  by default. */
  matrix?: readonly number[]
  /** The frame it shows while it does not play (`Frame`, 0). */
  frame?: number
  /** The frames a second it plays at (`FrameRate`, 24). */
  frameRate?: number
  /** The first and the last frame it plays between (`StartFrame` 0, `EndFrame` the volume's last). */
  startFrame?: number
  endFrame?: number
  /** Whether it plays (`bPlaying`, false), and whether it starts again at its end (`bLooping`,
   *  false). */
  playing?: boolean
  looping?: boolean
  /** Added to the mip level it streams at; higher is earlier coarser (`StreamingMipBias`, 0). */
  streamingMipBias?: number
  /** Whether it waits for its tiles instead of showing a coarser mip (`bIssueBlockingRequests`,
   *  false). */
  blockingRequests?: boolean
  /** Whether its pivot is its centre, else its lowest corner (`bPivotAtCentroid`, false). */
  pivotAtCentroid?: boolean
  /** The march's step, in voxels (`StepFactor`, 1); its shadow rays' (`ShadowStepFactor`, 2); the
   *  bias of its shadows (`ShadowBiasFactor`, 0.5); the downsample of its lighting
   *  (`LightingDownsampleFactor`, 2). */
  stepFactor?: number
  shadowStepFactor?: number
  shadowBiasFactor?: number
  lightingDownsampleFactor?: number
  /** Whether it casts shadows onto the scene (`CastShadow`, true), when the setting allows it. */
  castShadow?: boolean
  /** Whether it shows in the scene's main pass (true); off, only its shadow stays. */
  visible?: boolean
  /** Whether it draws black with an alpha of 0 while its shadows, reflections and indirect light stay (`bHoldout`, false). */
  holdout?: boolean
  /** A graph of the volume domain (`material.graph('volume')`) that gives its extinction
   *  (`subsurfaceColor`), its albedo (`baseColor`) and its emission (`emissive`) at each point of its
   *  march, reading the sparse volume with the sparse volume nodes. A volume with none is not drawn
   *  (`GetHeterogeneousVolumeMaterial`, `HeterogeneousVolumeComponent.cpp:420-432`). */
  graph?: MaterialGraph
}

/** A volume with every field set and held to its range. */
export interface ResolvedHeterogeneousVolume {
  id: string
  source: number
  matrix: readonly number[]
  frame: number
  frameRate: number
  startFrame: number
  /** None: the volume's last frame. */
  endFrame: number | undefined
  playing: boolean
  looping: boolean
  streamingMipBias: number
  blockingRequests: boolean
  pivotAtCentroid: boolean
  stepFactor: number
  shadowStepFactor: number
  shadowBiasFactor: number
  lightingDownsampleFactor: number
  castShadow: boolean
  visible: boolean
  holdout: boolean
  /** Its graph, and the graph's version when it was resolved: a write to the graph changes the record. */
  graph?: MaterialGraph
  graphVersion?: number
}

const refuse: VolumeRefusal = volumeRefusal(
  'INVALID_SCENE_HETEROGENEOUS_VOLUME',
  'heterogeneous volume',
)

function finite(id: string, name: string, value: unknown, fallback: number, least = -Infinity) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < least)
    refuse(id, `${name} expects a finite number${least > -Infinity ? ` of at least ${least}` : ''}`)
  return value
}

function flag(id: string, name: string, value: unknown, fallback: boolean) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') refuse(id, `${name} expects true or false`)
  return value
}

/**
 * The volume `volume` declares with every field set: the reference component's defaults where it
 * names none, the identity placement, frames held at or above zero and the end not before the start.
 * @throws EngineError `INVALID_SCENE_HETEROGENEOUS_VOLUME` naming the field that is not what it
 * expects.
 */
export function resolveHeterogeneousVolume(
  volume: SceneHeterogeneousVolume,
): ResolvedHeterogeneousVolume {
  const { id, matrix = IDENTITY_MATRIX } = volume
  if (typeof id !== 'string' || !id) refuse(id, 'id expects a non-empty string')
  if (!Number.isInteger(volume.source) || volume.source < 0)
    refuse(id, 'source expects the index of a node of the scene')
  checkMatrix(refuse, id, matrix)
  const startFrame = finite(id, 'startFrame', volume.startFrame, 0, 0)
  const endFrame =
    volume.endFrame === undefined
      ? undefined
      : finite(id, 'endFrame', volume.endFrame, 0, startFrame)
  return {
    id,
    source: volume.source,
    matrix: [...matrix],
    frame: finite(id, 'frame', volume.frame, 0, 0),
    frameRate: finite(id, 'frameRate', volume.frameRate, 24, 0),
    startFrame,
    endFrame,
    playing: flag(id, 'playing', volume.playing, false),
    looping: flag(id, 'looping', volume.looping, false),
    streamingMipBias: finite(id, 'streamingMipBias', volume.streamingMipBias, 0),
    blockingRequests: flag(id, 'blockingRequests', volume.blockingRequests, false),
    pivotAtCentroid: flag(id, 'pivotAtCentroid', volume.pivotAtCentroid, false),
    stepFactor: finite(id, 'stepFactor', volume.stepFactor, 1, Number.MIN_VALUE),
    shadowStepFactor: finite(id, 'shadowStepFactor', volume.shadowStepFactor, 2, Number.MIN_VALUE),
    shadowBiasFactor: finite(id, 'shadowBiasFactor', volume.shadowBiasFactor, 0.5, 0),
    lightingDownsampleFactor: finite(
      id,
      'lightingDownsampleFactor',
      volume.lightingDownsampleFactor,
      2,
      1,
    ),
    castShadow: flag(id, 'castShadow', volume.castShadow, true),
    visible: flag(id, 'visible', volume.visible, true),
    holdout: flag(id, 'holdout', volume.holdout, false),
    ...volumeGraphFields(refuse, id, volume.graph),
  }
}

/** The corners of a volume of `resolution` voxels in its own space: its lowest corner at the origin,
 *  or centred on it where it pivots at its centroid (`UHeterogeneousVolumeComponent::CalcBounds`,
 *  `HeterogeneousVolumeComponent.cpp:371-386`). */
export function heterogeneousVolumeBounds(
  resolution: Vec3,
  pivotAtCentroid: boolean,
): { min: Vec3; max: Vec3 } {
  const half = resolution.map((side) => side * 0.5) as unknown as Vec3
  const centre = pivotAtCentroid ? [0, 0, 0] : half
  return {
    min: [centre[0] - half[0], centre[1] - half[1], centre[2] - half[2]],
    max: [centre[0] + half[0], centre[1] + half[1], centre[2] + half[2]],
  }
}
