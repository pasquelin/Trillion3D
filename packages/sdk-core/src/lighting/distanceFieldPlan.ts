import {
  DISTANCE_FIELD_RULES,
  DISTANCE_FIELD_UNITS_PER_METRE,
} from '../contracts/distanceFieldAbi.ts'
import { resolveSettings } from '../contracts/settingRules.ts'
import type { DistanceFieldMip, MeshDistanceField } from './distanceFieldFile.ts'
import { BRICK_VOXELS, gridOf, type DistanceFieldBuildSettings } from './distanceFieldGrid.ts'
import { distanceFieldDirections } from './distanceFieldSamples.ts'
import { sceneOf, type Scene, type Vec3 } from './distanceFieldScene.ts'

/**
 * WHAT A FIELD'S BUILD STARTS FROM AND WHAT IT ENDS IN (`asset-compiler-rust/src/distance_field/build.rs`, which this follows step by
 * step): the scene of the mesh's triangles, its grid and the rays; and, once the bricks are measured, the bricks that hold a surface's band
 * kept in the order of their cells with each mip's indirection table naming them (`distanceFieldBuild.ts` measures them).
 */

const f = Math.fround

const DEFAULT_SETTINGS = /* @__PURE__ */ resolveSettings(DISTANCE_FIELD_RULES, {})

/** What a cell of the indirection table holds when its brick is not stored. */
const NO_BRICK = 0xffffffff

/** Whether a brick holds a surface's band: not all its voxels are the farthest inside or the farthest outside. */
const stored = (voxels: Uint8Array) => Math.min(...voxels) < 255 && Math.max(...voxels) > 0

/** What a build is given besides the triangles. `doubleSided` says the material is, `settings` the build's (the reference's by default). */
export type BuildOptions = { doubleSided?: boolean; settings?: Partial<DistanceFieldBuildSettings> }

/** What a build starts from: the scene, its grid and the rays. */
export interface Plan {
  readonly scene: Scene
  readonly grid: ReturnType<typeof gridOf>
  readonly directions: Float64Array
}

/** The plan of the triangles `indices` name in `positions` (metres, three floats a vertex); none where no triangle is left to measure or
 *  `settings` build no field. */
export function planOf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: BuildOptions,
): Plan | undefined {
  const settings = { ...DEFAULT_SETTINGS, ...options.settings }
  if (settings.distanceFieldScale <= 0) return undefined
  const scene = sceneOf(
    positions,
    indices,
    options.doubleSided ?? false,
    settings.distanceFieldTwoSided,
  )
  if (!scene) return undefined
  const grid = gridOf(scene.low, scene.high, settings, scene.mostlyTwoSided)
  return { scene, grid, directions: Float64Array.from(distanceFieldDirections().flat()) }
}

/** The field of `plan` as the compiled mesh `mesh`'s, its bricks each as `voxelsOf` measured them (none: the band's far end all
 *  through): those that hold a surface's band kept in the order of their cells. */
export function assemble(
  mesh: number,
  { scene, grid }: Plan,
  voxelsOf: (mip: number, rank: number) => Uint8Array | undefined,
): MeshDistanceField {
  const mips = grid.mips.map((mip, index): DistanceFieldMip => {
    const cells = mip.bricks[0] * mip.bricks[1] * mip.bricks[2]
    const indirection = new Uint32Array(cells).fill(NO_BRICK)
    const kept: Uint8Array[] = []
    for (let rank = 0; rank < cells; rank++) {
      const voxels = voxelsOf(index, rank)
      if (!voxels || !stored(voxels)) continue
      indirection[rank] = kept.length
      kept.push(voxels)
    }
    const bricks = new Uint8Array(kept.length * BRICK_VOXELS)
    kept.forEach((voxels, k) => bricks.set(voxels, k * BRICK_VOXELS))
    return {
      indirectionSize: mip.bricks,
      distanceScale: f(2 * mip.band),
      distanceBias: f(-mip.band),
      volumeToVirtualUvScale: mip.uvScale.map(f) as unknown as Vec3,
      volumeToVirtualUvAdd: mip.uvAdd.map(f) as unknown as Vec3,
      brickCount: kept.length,
      indirection,
      bricks,
    }
  })
  const metres = (v: Vec3) => v.map((c) => f(c / DISTANCE_FIELD_UNITS_PER_METRE)) as Vec3
  return {
    mesh,
    hlodCell: false,
    mostlyTwoSided: scene.mostlyTwoSided,
    min: metres(grid.low),
    max: metres(grid.high),
    mips,
  }
}
