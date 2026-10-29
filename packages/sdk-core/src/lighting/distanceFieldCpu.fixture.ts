// The field of a mesh with every voxel measured on the CPU in double precision, brick by brick: the oracle the GPU's build is checked
// against (`distanceFieldBuild.test.ts`, `distanceFieldGpu.test.ts`) and the build the compiler falls back on where it has no device
// (`asset-compiler-rust/src/distance_field/build.rs`, `on_cpu`). A mesh of a few triangles takes seconds, a large one minutes: the engine never
// builds a field this way.
import type { MeshDistanceField } from './distanceFieldFile.ts'
import {
  BRICK_VOXELS,
  cellOf,
  frameOf,
  quantise,
  reached,
  voxelAt,
  volumeOf,
  type MipGrid,
} from './distanceFieldGrid.ts'
import { finishDistanceField, measureField, prepareDistanceField } from './distanceFieldBuild.ts'
import type { VoxelKernel } from './distanceFieldGpu.ts'
import { assemble, planOf, type BuildOptions } from './distanceFieldPlan.ts'
import { signedDistance, type Scene, type Vec3 } from './distanceFieldScene.ts'

/** The voxels of the brick at cell `at` of `mip`, measured against `scene` on the CPU; none where no triangle can reach it. */
function brickOf(
  scene: Scene,
  mip: MipGrid,
  directions: Float64Array,
  at: Vec3,
): Uint8Array | undefined {
  const frame = frameOf(mip, at)
  if (!reached(scene, mip, frame)) return undefined
  const volume = Float64Array.from(volumeOf(mip).flat())
  const voxels = new Uint8Array(BRICK_VOXELS)
  const p: Vec3 = [0, 0, 0]
  for (let index = 0; index < BRICK_VOXELS; index++)
    voxels[index] = quantise(
      mip,
      signedDistance(scene, voxelAt(frame, index, p), mip.traceDistance, directions, volume),
    )
  return voxels
}

/**
 * The field of the triangles `indices` name in `positions` (metres, three floats a vertex) as the compiled mesh `mesh`'s, every voxel
 * measured on the CPU in double precision; none where the mesh holds no triangle to measure.
 */
export function buildDistanceField(
  mesh: number,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: BuildOptions = {},
): MeshDistanceField | undefined {
  const plan = planOf(positions, indices, options)
  if (!plan) return undefined
  const { scene, grid, directions } = plan
  return assemble(mesh, plan, (mip, rank) =>
    brickOf(scene, grid.mips[mip], directions, cellOf(rank, grid.mips[mip].bricks)),
  )
}

/** The field `kernel` gives, the three halves of the build run on one thread: what the engine does across a worker and the device. */
export async function buildDistanceFieldOnGpu(
  kernel: VoxelKernel,
  mesh: number,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: BuildOptions = {},
): Promise<MeshDistanceField | undefined> {
  const prepared = prepareDistanceField(positions, indices, options)
  if (!prepared) return undefined
  const measured = await measureField(kernel, prepared)
  return finishDistanceField(mesh, positions, indices, measured, options)
}
