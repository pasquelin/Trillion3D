import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { hasTextureFormatsTier2 } from '../../gpu/core/textureFormatsTier.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { ALLOCATE_ENTRIES, ALLOCATE_SHADER, LISTS_SHADER } from './allocateWgsl.ts'
import { CLIP_BLOCK } from './clipmapBlock.ts'
import { COMPOSE_ENTRY, composeShader } from './composeWgsl.ts'
import { COVERAGE_ENTRY, coverageShader } from './coverageWgsl.ts'
import {
  CULL_BLOCK,
  CULL_CLIPMAP_SHADER,
  CULL_ENTRIES,
  CULL_GRID_SHADER,
  GRID_TILES_SHADER,
} from './cullWgsl.ts'
import { FILL_SHADER, MIP_BLOCK, MIP_ENTRIES, mipShader } from './mipWgsl.ts'
import { OBJECT_GRID_ENTRY, OBJECT_GRID_SHADER } from './objectGridWgsl.ts'
import { sceneLayoutEntries } from './sceneBindings.ts'

/**
 * THE LAYOUTS AND PIPELINES OF THE GLOBAL DISTANCE FIELD'S PASSES, made once, each pipeline compiled
 * off the frame and started at once; a frame updates the field only when every one is ready. A pass
 * that reads the meshes' fields has the scene's group first and its own after; a block is read at a
 * dynamic offset, one slot of its buffer for each clipmap of each cache. The page atlas is bound as a
 * storage texture (composition, coverage), a sampled texture and its sampler (the mip), where the
 * device allows (`../../gpu/core/textureFormatsTier.ts`), else as a buffer of bytes.
 */

const ro = 'read-only-storage'
const rw = 'storage'
const ATLAS_FORMAT = 'r8unorm'
const dynamic = (bytes: number) =>
  computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: bytes })

type MakeLayout = (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout

/** The layouts of the scene's group and of the passes that cull. */
function cullLayouts(layout: MakeLayout, clip: number) {
  return {
    scene: layout(sceneLayoutEntries()),
    cull: layout([
      dynamic(CULL_BLOCK.words * 4),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, rw),
      computeBufferEntry(3, rw),
    ]),
    tiles: layout([
      dynamic(clip),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, rw),
      computeBufferEntry(3, rw),
    ]),
    grid: layout([
      dynamic(clip),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, ro),
      computeBufferEntry(3, rw),
      computeBufferEntry(4, rw),
    ]),
  }
}

/** The layouts of the passes over the page tables and the atlas. */
function pageLayouts(layout: MakeLayout, clip: number, textured: boolean) {
  return {
    allocate: layout([
      dynamic(clip),
      computeBufferEntry(1, rw),
      computeStorageTextureEntry(2, 'r32uint', 'read-write', '3d'),
      computeStorageTextureEntry(3, 'r32uint', 'write-only', '3d'),
      computeTextureEntry(4, 'uint', '3d'),
      computeBufferEntry(5, rw),
      computeBufferEntry(6, rw),
      computeBufferEntry(7, ro),
    ]),
    lists: layout([
      dynamic(clip),
      computeBufferEntry(1, rw),
      computeBufferEntry(2, rw),
      computeBufferEntry(3, rw),
    ]),
    compose: layout([
      dynamic(clip),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, ro),
      textured
        ? computeStorageTextureEntry(3, ATLAS_FORMAT, 'read-write', '3d')
        : computeBufferEntry(3, rw),
      computeTextureEntry(4, 'uint', '3d'),
      computeTextureEntry(5, 'uint', '3d'),
    ]),
    coverage: layout([
      dynamic(clip),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, ro),
      textured
        ? computeStorageTextureEntry(3, ATLAS_FORMAT, 'read-only', '3d')
        : computeBufferEntry(3, rw),
      computeTextureEntry(4, 'uint', '3d'),
      computeStorageTextureEntry(5, 'r32uint', 'read-write', '3d'),
      ...(textured ? [computeBufferEntry(6, rw)] : []),
    ]),
    objectGrid: layout([
      dynamic(clip),
      computeBufferEntry(1, ro),
      computeBufferEntry(2, ro),
      computeBufferEntry(3, rw),
      computeTextureEntry(4, 'uint', '3d'),
      computeTextureEntry(5, 'uint', '3d'),
    ]),
  }
}

/** The layouts of the coarse mip and of the page table fill. */
function mipLayouts(layout: MakeLayout, textured: boolean) {
  return {
    mip: layout([
      dynamic(MIP_BLOCK.words * 4),
      computeTextureEntry(1, 'uint', '3d'),
      textured ? computeTextureEntry(2, 'float', '3d') : computeBufferEntry(2, ro),
      computeTextureEntry(3, 'unfilterable-float', '3d'),
      computeStorageTextureEntry(4, 'r32float', 'write-only', '3d'),
      ...(textured ? [computeSamplerEntry(5)] : []),
    ]),
    fill: layout([computeStorageTextureEntry(0, 'r32uint', 'write-only', '3d')]),
  }
}

/** The layouts of the passes' own groups. */
function passLayouts(device: GPUDevice, textured: boolean) {
  const layout: MakeLayout = (entries) => device.createBindGroupLayout({ entries })
  const clip = CLIP_BLOCK.words * 4
  return {
    ...cullLayouts(layout, clip),
    ...pageLayouts(layout, clip, textured),
    ...mipLayouts(layout, textured),
  }
}

/** The stages of the passes. */
export type StageKey =
  | 'cull'
  | 'tiles'
  | 'grid'
  | 'allocate'
  | 'lists'
  | 'compose'
  | 'coverage'
  | 'objectGrid'
  | 'mip'
  | 'fill'

type PassLayouts = ReturnType<typeof passLayouts>

/** The compiled stages of one pass: `entries` of `code` over the groups `groups`. */
const stagesOf = (
  device: GPUDevice,
  label: string,
  groups: GPUBindGroupLayout[],
  code: string,
  entries: string[],
  constants?: Record<string, number>,
) =>
  startedComputeStages(
    device,
    `Trillion3D global distance field ${label}`,
    device.createPipelineLayout({ bindGroupLayouts: groups }),
    device.createShaderModule({ label: `Trillion3D global distance field ${label}`, code }),
    entries,
    constants,
  )

/** The stages of every pass but the object grid's. */
function passStages(device: GPUDevice, layouts: PassLayouts, textured: boolean) {
  const stages = stagesOf.bind(null, device)
  return {
    cull: stages('culling to clipmaps', [layouts.scene, layouts.cull], CULL_CLIPMAP_SHADER, [
      CULL_ENTRIES.clipmap,
    ]),
    tiles: stages('tiles', [layouts.tiles], GRID_TILES_SHADER, [CULL_ENTRIES.tiles]),
    grid: stages('culling grid', [layouts.scene, layouts.grid], CULL_GRID_SHADER, [
      CULL_ENTRIES.grid,
    ]),
    allocate: stages('page allocation', [layouts.scene, layouts.allocate], ALLOCATE_SHADER, [
      ALLOCATE_ENTRIES.allocate,
    ]),
    lists: stages(
      'page lists',
      [layouts.lists],
      LISTS_SHADER,
      [
        ALLOCATE_ENTRIES.init,
        ALLOCATE_ENTRIES.updateArgs,
        ALLOCATE_ENTRIES.composeArgs,
        ALLOCATE_ENTRIES.returnArgs,
        ALLOCATE_ENTRIES.returnPages,
      ],
      groupWidthConstants(groupWidth(device.limits)),
    ),
    compose: stages('composition', [layouts.scene, layouts.compose], composeShader(textured), [
      COMPOSE_ENTRY,
    ]),
    coverage: stages('page coverage', [layouts.scene, layouts.coverage], coverageShader(textured), [
      COVERAGE_ENTRY,
    ]),
    mip: stages('coarse mip', [layouts.mip], mipShader(textured), [MIP_ENTRIES.propagate]),
    fill: stages('page table fill', [layouts.fill], FILL_SHADER, [MIP_ENTRIES.fill]),
  }
}

/** The passes' layouts and compiled stages. */
export function createGlobalPipelines(device: GPUDevice) {
  const textured = hasTextureFormatsTier2(device)
  const layouts = passLayouts(device, textured)
  const pipelines = passStages(device, layouts, textured)
  // The object grid's stage is compiled from the first frame a pass reads the grid, never for a field none does.
  let grid: ReturnType<typeof stagesOf> | undefined
  const gridStage = () =>
    (grid ??= stagesOf(
      device,
      'object grid',
      [layouts.scene, layouts.objectGrid],
      OBJECT_GRID_SHADER,
      [OBJECT_GRID_ENTRY],
    ))
  return {
    layouts,
    pipelines,
    /** Starts compiling the object grid's stage, once. */
    wantObjectGrid() {
      gridStage()
    },
    /** The compiled pipeline of `entry` in the stage `key`. */
    stage: (key: StageKey, entry: string) =>
      (key === 'objectGrid' ? gridStage() : pipelines[key]).pipelineOf(entry),
    /** Whether every stage asked for is compiled. */
    get ready() {
      return Object.values(pipelines).every((stage) => stage.ready) && (grid?.ready ?? true)
    },
  }
}

export type GlobalPipelines = ReturnType<typeof createGlobalPipelines>
