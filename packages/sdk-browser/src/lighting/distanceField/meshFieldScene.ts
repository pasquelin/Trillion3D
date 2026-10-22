import { floorLog2 } from '../../../../math/src/scalar/integers.ts'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { createAtlasGpu, type AtlasGpu } from './atlasGpu.ts'
import { stepAtlas } from './atlasRequests.ts'
import { createAtlasState, type AtlasBudget } from './atlasState.ts'
import { createObjectBuffers } from './objectBuffers.ts'
import { createObjectTracker, type ModifiedBoxes, type TrackedRoot } from './objectTracker.ts'
import { sceneBindEntries, sceneBindGroup } from './sceneBindings.ts'
import { createStreaming } from './streaming.ts'
import type { Vec3 } from './regionBounds.ts'

/**
 * THE MESHES' DISTANCE FIELDS IN THE SCENE: the placements that have one (`ObjectTracker`) with
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

const floorPow2 = (n: number) => 1 << floorLog2(Math.max(1, Math.floor(n)))

/** The scene of the meshes' fields, for the meshes of `fields`, read by passes laid out by `sceneLayout`. */
export function createMeshFieldScene(
  device: GPUDevice,
  fields: readonly MeshDistanceField[],
  sceneLayout: GPUBindGroupLayout,
) {
  const atlas = createAtlasState()
  const tracker = createObjectTracker(new Map(fields.map((field) => [field.mesh, field])), atlas)
  const objects = createObjectBuffers(device)
  const streaming = createStreaming(device, sceneLayout)
  let gpu: AtlasGpu | undefined
  let fixed: Pick<AtlasBudget, 'sizeXY' | 'blockBricks'> | undefined
  let group: GPUBindGroup | undefined
  let held: unknown[] = []
  let generation = 0

  /** The budget the settings give; the atlas's shape the first ones. */
  function budgetOf(settings: GlobalDistanceFieldSettings): AtlasBudget {
    fixed ??= {
      sizeXY: floorPow2(settings.meshDistanceFieldBrickAtlasSize),
      blockBricks: settings.meshDistanceFieldBlockBricks,
    }
    return {
      ...fixed,
      maxDepth: settings.meshDistanceFieldBrickAtlasDepth,
      uploadBytes: settings.meshDistanceFieldUploadKiB * 1024,
      reverseOrder: settings.meshDistanceFieldReverseAllocation,
    }
  }

  /** The bind group over the resources as they are; whether it is a new one. */
  function groupOver(resources: AtlasGpu) {
    const now = [
      resources.sceneBuffer,
      resources.records.assets,
      resources.records.table,
      resources.brickTexture,
      objects.bounds,
      objects.data,
    ]
    const same = group && now.every((resource, k) => resource === held[k])
    if (!same) {
      generation++
      held = now
      group = sceneBindGroup(device, sceneLayout, resources, objects)
    }
    return !same
  }

  return {
    atlas,
    streaming,
    get count() {
      return tracker.objects.length
    },
    /** How many times the resources the bindings name were made anew; 0 before the first image of the field. */
    get generation() {
      return generation
    },
    /** The bind group entries of the scene's bindings (`MESH_FIELD_BINDINGS`) from `first`, over the resources now:
     *  a pass with bindings of its own binds them beside its own, and makes its group again when `generation` moves. */
    bindEntries: (first: number) => sceneBindEntries(first, gpu!, objects),
    /** Brings the scene level with `frame` and encodes the GPU's asks on `encoder`. */
    update(
      encoder: GPUCommandEncoder,
      frame: MeshFieldFrame,
      settings: GlobalDistanceFieldSettings,
    ): MeshFieldState {
      const maxRadius = settings.meshDistanceFieldMaxObjectRadius
      tracker.sync(frame.roots, frame.moving, frame.epoch, maxRadius)
      const budget = budgetOf(settings)
      gpu ??= createAtlasGpu(device, budget.sizeXY)
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
      const remade = groupOver(gpu)
      streaming.encode(encoder, group!, {
        origin: frame.origin,
        settings,
        assets: atlas.assets.length,
        objects: count,
      })
      return {
        group: group!,
        objects: count,
        modified: tracker.takeModified(),
        pendingStreaming: atlas.requests.length > 0,
        remade,
      }
    },
    submitted: () => streaming.submitted(),
    dispose() {
      streaming.dispose()
      objects.dispose()
      gpu?.dispose()
    },
  }
}

export type MeshFieldScene = ReturnType<typeof createMeshFieldScene>
