import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { createAtlasGpu, type AtlasGpu } from './atlasGpu.ts'
import { stepAtlas } from './atlasRequests.ts'
import { createAtlasState } from './atlasState.ts'
import { createHlodObjects, movingOf, type HlodDraws } from './hlodObjects.ts'
import { createObjectBuffers } from './objectBuffers.ts'
import {
  createObjectTracker,
  type ModifiedBoxes,
  type RuntimeField,
  type TrackedRoot,
} from './objectTracker.ts'
import { sceneBindEntries } from './sceneBindings.ts'
import { createBudget, createSceneGroup } from './sceneParts.ts'
import { createStreaming } from './streaming.ts'
import type { Vec3 } from './regionBounds.ts'

/**
 * THE MESHES' DISTANCE FIELDS IN THE SCENE: the placements that have one (`createObjectTracker`) — a
 * compiled mesh's, or, in the world DAG, an HLOD cell's actors' (`hlodObjects.ts`) — with
 * their records on the GPU (`ObjectBuffers`), the brick atlas the meshes' mips are streamed into
 * (`AtlasState`, `AtlasGpu`) and the asks the GPU makes of it (`Streaming`). A frame brings them level with the cut's
 * roots — placements added, moved or gone, then the mips the GPU asked for a few frames ago —,
 * encodes the GPU's asks for the frames to come, and hands the passes that read distances one
 * bind group over all of it. The atlas's first two sides and its blocks are read when it is first
 * made.
 */

/** What a frame brings level. */
export interface MeshFieldFrame {
  readonly roots: readonly TrackedRoot[]
  /** The cut's world cells, which say whether an HLOD cell's actors draw; none for a cut without a
   *  world DAG. */
  readonly world?: HlodDraws
  /** Whether the placement of root `rank` is often moving. */
  readonly moving: (rank: number) => boolean
  /** A number that changes when the scene changed shape. */
  readonly epoch: number
  /** The camera, centimetres. */
  readonly origin: Vec3
}

/** What a frame leaves for the global field. */
export interface MeshFieldState {
  readonly group: GPUBindGroup
  readonly objects: number
  readonly modified: ModifiedBoxes
  readonly pendingStreaming: boolean
  /** Whether a buffer or the atlas was made anew: the bind group is not the one before. */
  readonly remade: boolean
}

/** What a scene is made of: the placements and their atlas, the records and the GPU's asks. */
type SceneParts = {
  atlas: ReturnType<typeof createAtlasState>
  tracker: ReturnType<typeof createObjectTracker>
  hlod: ReturnType<typeof createHlodObjects>
  objects: ReturnType<typeof createObjectBuffers>
  streaming: ReturnType<typeof createStreaming>
  budget: ReturnType<typeof createBudget>
  group: ReturnType<typeof createSceneGroup>
  /** The atlas on the GPU, made at the first frame. */
  gpu?: AtlasGpu
  /** The roots the last frame placed: the cut's, then the stand-ins of the HLOD cells' actors. */
  roots?: readonly TrackedRoot[]
}

/** Brings the scene `scene` of `device` level with `frame` and encodes the GPU's asks on `encoder`. */
function updateScene(
  device: GPUDevice,
  scene: SceneParts,
  encoder: GPUCommandEncoder,
  frame: MeshFieldFrame,
  settings: GlobalDistanceFieldSettings,
): MeshFieldState {
  const { atlas, tracker, objects, streaming } = scene
  const maxRadius = settings.meshDistanceFieldMaxObjectRadius
  // The cut's roots, and after them the stand-ins of the world DAG's HLOD cells.
  const roots = (scene.roots = scene.hlod.join(frame.roots, frame.world))
  tracker.sync(roots, movingOf(frame.roots, roots, frame.moving), frame.epoch, maxRadius)
  const budget = scene.budget(settings)
  const gpu = (scene.gpu ??= createAtlasGpu(device, budget.sizeXY))
  const step = stepAtlas(atlas, budget, streaming.takeAnswer())
  const count = tracker.objects.length
  gpu.apply(atlas, step, budget, count)
  objects.ensure(count)
  const indices = tracker.takeUpload()
  const written = objects.write(
    indices,
    tracker.sourceOf,
    settings.meshDistanceFieldSurfaceBiasExpand,
  )
  tracker.requeue(indices.slice(written))
  const remade = scene.group.over(gpu)
  const { current: group } = scene.group
  const assets = atlas.assets.length
  streaming.encode(encoder, group, { origin: frame.origin, settings, assets, objects: count })
  return {
    group,
    objects: count,
    modified: tracker.takeModified(),
    pendingStreaming: atlas.requests.length > 0 || atlas.added.size > 0,
    remade,
  }
}

/** The scene of the meshes' fields, for the meshes of `fields` and those cut at run time that `runtime` gives one, read by passes laid out by `sceneLayout`. */
export function createMeshFieldScene(
  device: GPUDevice,
  fields: readonly MeshDistanceField[],
  sceneLayout: GPUBindGroupLayout,
  runtime?: RuntimeField,
) {
  const atlas = createAtlasState()
  const meshes = fields.filter((field) => !field.hlodCell)
  const objects = createObjectBuffers(device)
  const scene: SceneParts = {
    atlas,
    tracker: createObjectTracker(
      new Map(meshes.map((field) => [field.mesh, field])),
      atlas,
      runtime,
    ),
    hlod: createHlodObjects(fields),
    objects,
    streaming: createStreaming(device, sceneLayout),
    budget: createBudget(),
    group: createSceneGroup(device, sceneLayout, objects),
  }
  const { tracker, streaming } = scene
  return {
    atlas,
    streaming,
    get count() {
      return tracker.objects.length
    },
    /** The roots the last frame placed — the cut's, and after them the stand-ins of the HLOD cells' actors
     *  the cut draws —, none before the first: what the surface cache's placements follow too. */
    get roots() {
      return scene.roots
    },
    /** The placements in the order of the GPU's records: each with the cut's root it places and its record's rank. */
    get placements() {
      return tracker.objects
    },
    /** How many times the resources the bindings name were made anew; 0 before the first image of the field. */
    get generation() {
      return scene.group.generation
    },
    /** The bind group entries of the scene's seven bindings from `first`, over the resources now:
     *  a pass with bindings of its own binds them beside its own, and makes its group again when `generation` moves. */
    bindEntries: (first: number) => sceneBindEntries(first, scene.gpu!, objects),
    /** Brings the scene level with `frame` and encodes the GPU's asks on `encoder`. */
    update: (
      encoder: GPUCommandEncoder,
      frame: MeshFieldFrame,
      settings: GlobalDistanceFieldSettings,
    ) => updateScene(device, scene, encoder, frame, settings),
    submitted: () => streaming.submitted(),
    dispose() {
      streaming.dispose()
      objects.dispose()
      scene.gpu?.dispose()
    },
  }
}

export type MeshFieldScene = ReturnType<typeof createMeshFieldScene>
