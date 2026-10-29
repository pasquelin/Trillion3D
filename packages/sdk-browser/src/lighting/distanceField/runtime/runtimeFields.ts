import { measureField } from '../../../../../sdk-core/src/lighting/distanceFieldBuild.ts'
import type { MeshDistanceField } from '../../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type {
  Measured,
  PreparedField,
  VoxelKernel,
} from '../../../../../sdk-core/src/lighting/distanceFieldGpu.ts'
import {
  treeTriangles,
  type RayTracingTree,
} from '../../../../../sdk-core/src/lighting/rayTracingTree.ts'
import type { TrackedRoot } from '../objectTable.ts'

/**
 * THE DISTANCE FIELDS OF THE MESHES A WORLD CUT AT RUN TIME (`runtimeMeshDistanceFields`): a mesh no compiler saw has no field, so one is built
 * where the mesh is made, by the compiler's own program on the page's device. The triangles are those of the tree rays walk over the mesh
 * (`Primitive.rayTracing`), which every placement of the primitive shares and which is made only for a mesh that does not deform: a mesh that
 * does, or that has no tree, gets none. The build is cut in three where the work is: the CPU's first half (the scene, the grid, the bricks to
 * measure) and last (the voxels in doubt measured again, the field assembled) run in the page's workers (`tasks`), the voxels between them on
 * the device (`measureField`), so the page's frames never wait on a tree. A field is built once for each tree, one at a time: a placement
 * asks (`fieldOf`) and gets none until its field is built, when `version` moves and the scene reads its roots again. A build that fails is
 * said (`failed`) and not tried again.
 */
export interface RuntimeFields {
  /** The field built for the primitive `root` places, none while it is being built or when it gets none; starts the build the first time. */
  fieldOf(root: TrackedRoot): MeshDistanceField | undefined
  /** A number that moves each time a build ends. */
  readonly version: number
  /** Stops the build in flight and the ones queued. */
  dispose(): void
}

/** The two halves of a build that run off the page's thread: the triangles are nine floats each. */
export interface RuntimeFieldTasks {
  plan(positions: Float32Array, doubleSided: boolean): Promise<PreparedField | undefined>
  finish(
    mesh: number,
    positions: Float32Array,
    doubleSided: boolean,
    measured: Measured,
  ): Promise<MeshDistanceField | undefined>
}

/** The fields of the trees of the page, measured by the kernel `kernelOf` makes for the signal that stops it (`createVoxelKernel`); `failed`
 *  hears a build that did not end. */
export function createRuntimeFields(
  kernelOf: (signal: AbortSignal) => VoxelKernel,
  tasks: RuntimeFieldTasks,
  failed: (error: unknown) => void,
): RuntimeFields {
  const abort = new AbortController()
  const kernel = kernelOf(abort.signal)
  const held = new WeakMap<RayTracingTree, { field?: MeshDistanceField }>()
  let queue: Promise<void> = Promise.resolve()
  let version = 0
  // Their numbers are below every compiled mesh's, which start at 0.
  let mesh = -1
  const build = (tree: RayTracingTree, doubleSided: boolean, into: { field?: MeshDistanceField }) =>
    (queue = queue.then(async () => {
      if (abort.signal.aborted) return
      const { positions } = treeTriangles(tree)
      try {
        const prepared = await tasks.plan(positions, doubleSided)
        if (prepared) {
          const measured = await measureField(kernel, prepared)
          into.field = await tasks.finish(mesh, positions, doubleSided, measured)
          if (into.field) mesh--
        }
      } catch (error) {
        if (!abort.signal.aborted) failed(error)
      }
      if (!abort.signal.aborted) version++
    }))
  return {
    fieldOf({ rayTracing, doubleSided }) {
      if (!rayTracing) return undefined
      let state = held.get(rayTracing)
      if (!state) {
        held.set(rayTracing, (state = {}))
        void build(rayTracing, !!doubleSided, state)
      }
      return state.field
    },
    get version() {
      return version
    },
    dispose: () => abort.abort(),
  }
}
