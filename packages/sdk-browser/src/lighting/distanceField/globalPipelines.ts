import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { ALLOCATE_ENTRIES, ALLOCATE_SHADER, LISTS_SHADER } from './allocateWgsl.ts'
import { CLIP_BLOCK } from './clipmapBlock.ts'
import { COMPOSE_ENTRY, COMPOSE_SHADER } from './composeWgsl.ts'
import {
  CULL_BLOCK,
  CULL_CLIPMAP_SHADER,
  CULL_ENTRIES,
  CULL_GRID_SHADER,
  GRID_TILES_SHADER,
} from './cullWgsl.ts'
import { FILL_SHADER, MIP_BLOCK, MIP_ENTRIES, MIP_SHADER } from './mipWgsl.ts'
import { sceneLayoutEntries } from './sceneBindings.ts'

/**
 * THE LAYOUTS AND PIPELINES OF THE GLOBAL DISTANCE FIELD'S PASSES, made once, each pipeline compiled
 * off the frame and started at once; a frame updates the field only when every one is ready. A pass
 * that reads the meshes' fields has the scene's group first and its own after; a block is read at a
 * dynamic offset, one slot of its buffer for each clipmap of each cache.
 */

const ro = 'read-only-storage'
const rw = 'storage'
const dynamic = (bytes: number) =>
  computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: bytes })

/** The layouts of the passes' own groups. */
function passLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  const clip = CLIP_BLOCK.words * 4
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
      computeBufferEntry(3, rw),
      computeTextureEntry(4, 'uint', '3d'),
      computeTextureEntry(5, 'uint', '3d'),
    ]),
    mip: layout([
      dynamic(MIP_BLOCK.words * 4),
      computeTextureEntry(1, 'uint', '3d'),
      computeBufferEntry(2, ro),
      computeTextureEntry(3, 'unfilterable-float', '3d'),
      computeStorageTextureEntry(4, 'r32float', 'write-only', '3d'),
    ]),
    fill: layout([computeStorageTextureEntry(0, 'r32uint', 'write-only', '3d')]),
  }
}

/** The stages of the passes. */
export type StageKey = 'cull' | 'tiles' | 'grid' | 'allocate' | 'lists' | 'compose' | 'mip' | 'fill'

/** The passes' layouts and compiled stages. */
export function createGlobalPipelines(device: GPUDevice) {
  const layouts = passLayouts(device)
  const stages = (
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
  const pipelines = {
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
    compose: stages('composition', [layouts.scene, layouts.compose], COMPOSE_SHADER, [
      COMPOSE_ENTRY,
    ]),
    mip: stages('coarse mip', [layouts.mip], MIP_SHADER, [MIP_ENTRIES.propagate]),
    fill: stages('page table fill', [layouts.fill], FILL_SHADER, [MIP_ENTRIES.fill]),
  }
  return {
    layouts,
    pipelines,
    /** The compiled pipeline of `entry` in the stage `key`. */
    stage: (key: StageKey, entry: string) =>
      (pipelines[key] as { pipelineOf(entry: string): GPUComputePipeline }).pipelineOf(entry),
    /** Whether every stage is compiled. */
    get ready() {
      return Object.values(pipelines).every((stage) => stage.ready)
    },
  }
}

export type GlobalPipelines = ReturnType<typeof createGlobalPipelines>
