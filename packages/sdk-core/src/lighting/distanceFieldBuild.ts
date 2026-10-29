import { BRICK_VOXELS, cellOf, frameOf, reached } from './distanceFieldGrid.ts'
import {
  landVoxels,
  prepareField,
  remeasure,
  voxelJobOf,
  type Doubtful,
  type Measured,
  type PreparedField,
  type Touched,
  type VoxelKernel,
} from './distanceFieldGpu.ts'
import type { MeshDistanceField } from './distanceFieldFile.ts'
import { assemble, planOf, type BuildOptions, type Plan } from './distanceFieldPlan.ts'

/**
 * THE DISTANCE FIELD OF A MESH THE COMPILER DID NOT BUILD, built where the mesh is made: the same field, in the same layout, as the
 * compiler's (`asset-compiler-rust/src/distance_field/`: `grid.rs`, `brick.rs`, `scene.rs`, `samples.rs`, `build.rs`, `gpu.rs`, which this
 * follows step by step), so that the one reader takes both (`distanceFieldFile.ts`). The steps:
 *
 * 1. the scene: the mesh's triangles in centimetres (single precision), those with a cross product under 1e-4 of a square centimetre left
 *    out, the box of every corner, the mesh mostly two-sided where a quarter of its triangles or more are (or the build asks for all);
 * 2. the grid (`distanceFieldGrid.ts`), and the bricks no triangle can reach, which are the band's far end all through and hold no measure;
 * 3. each voxel of the other bricks: the nearest triangle's distance within the band, negative where more than a quarter of the
 *    98 rays across the sphere (`distanceFieldDirections`) meet a back face first, quantised to a byte over the band;
 * 4. the bricks that hold a surface's band, in the order of their cells, and each mip's indirection table naming them.
 *
 * Step 3 runs as the compiler runs it on its device: by the compiler's own kernel (`distanceFieldGpu.ts`), the voxels it was in doubt of
 * measured again on the CPU in double precision. Three functions cut the build where the device is: `prepareDistanceField` and
 * `finishDistanceField` are CPU work a worker does, `measureField` is the device's. Where a ray's tie between two triangles has the compiler pick the lower slot of its own
 * tree, here the lower slot of ours: the field is the same to within the order of that tree, not promised byte for byte.
 */

/** The bricks of every mip that hold a triangle's reach, mip after mip, rank after rank. */
function touchedBricks({ scene, grid }: Plan): Touched[] {
  const found: Touched[] = []
  grid.mips.forEach((mip, index) => {
    const cells = mip.bricks[0] * mip.bricks[1] * mip.bricks[2]
    for (let rank = 0; rank < cells; rank++)
      if (reached(scene, mip, frameOf(mip, cellOf(rank, mip.bricks))))
        found.push({ mip: index, rank })
  })
  return found
}

/**
 * The first half of a field's build, all on the CPU: the scene, the grid, the bricks no triangle can reach left out, and what the kernel
 * is sent for the others (`prepareField`); none where the mesh holds no triangle to measure. Plain data, so a worker can make it
 * (`geometry/work/task.ts`) and the page's thread take it to the device.
 */
export function prepareDistanceField(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: BuildOptions = {},
): PreparedField | undefined {
  const plan = planOf(positions, indices, options)
  if (!plan) return undefined
  return prepareField(plan.scene, plan.grid.mips, plan.directions, touchedBricks(plan))
}

/** The voxels `prepared` names measured by `kernel` — the compiler's program on a device —: their bytes, and the ones to measure again. A
 *  `VoxelKernelRefused` when the kernel cannot walk the mesh, whatever the kernel rejects with otherwise: the field is not built another way. */
export async function measureField(
  kernel: VoxelKernel,
  prepared: PreparedField,
): Promise<Measured> {
  const job = voxelJobOf(prepared)
  const into = { voxels: new Uint8Array(job.count), doubtful: [] as Doubtful[] }
  if (job.count) await kernel(job, (first, results) => landVoxels(job, first, results, into))
  return into
}

/**
 * The second half, on the CPU again: the voxels the kernel was in doubt of, or dropped, measured in double precision, and the bricks that
 * hold a surface's band kept in the order of their cells as the compiled mesh `mesh`'s field. The plan is made again from the triangles,
 * which `prepareDistanceField` made from the same; none where the mesh holds no triangle to measure.
 */
export function finishDistanceField(
  mesh: number,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  { voxels, doubtful }: Measured,
  options: BuildOptions = {},
): MeshDistanceField | undefined {
  const plan = planOf(positions, indices, options)
  if (!plan) return undefined
  const { scene, grid, directions } = plan
  const touched = touchedBricks(plan)
  remeasure(scene, grid.mips, directions, touched, doubtful, voxels)
  // The bricks measured, per mip by their cell's rank; the others are the band's far end all through.
  const measured = grid.mips.map(() => new Map<number, Uint8Array>())
  touched.forEach(({ mip, rank }, brick) =>
    measured[mip].set(rank, voxels.subarray(brick * BRICK_VOXELS, (brick + 1) * BRICK_VOXELS)),
  )
  return assemble(mesh, plan, (mip, rank) => measured[mip].get(rank))
}
