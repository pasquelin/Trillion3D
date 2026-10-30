import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline } from '../../deferred/fullscreen.ts'
import type { ClosureSide } from '../closureSides.ts'
import type { ClosureTiles } from '../../../visibility/closureTiles/closureTiles.ts'
import {
  CLOSURE_TILE_SIZE,
  closureRegionOf,
  overflowTilesBlock,
} from '../../../visibility/closureTiles/closureTilesWgsl.ts'
import { LOBES_DECODE_WGSL, LOBES_LIGHTING_WGSL } from '../../direct/lobesWgsl.ts'
import { directLightWgsl } from '../../direct/lightWgsl.ts'
import { TOON_TABLES_NONE_WGSL } from '../../toon/tablesWgsl.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { REFLECTION_CLASSIFY_WGSL, CLASSIFY_TILE_STATEMENTS } from '../tiles.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../viewLayout.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
  closureClassifyLayouts,
} from './traceBindings.ts'

/**
 * THE CLASSIFICATION OF THE TILES OF A CLOSURE PAST THE FIRST, over its overflow tiles as the reference's is (`StochasticLighting.cpp:540-835`, the tile classification with the
 * closure's index over the overflow tile list; `Reflections.cpp:1511-1823`, the reflection tiles of each closure): not a sweep of the whole grid, three kernels.
 *
 * - `markClosureTiles`, indirect over the closure's overflow tiles (`closureArgsAt`, the 8 by 8 pixel tiles that hold the closure): each marks, by an atomic, the tracing tile that
 *   holds it (a tracing tile is `REFLECTION_SIDE` texels of a block of pixels a side, so an overflow tile is in one): many overflow tiles mark one tile, which is marked once.
 * - `listClosureTiles`, over the tracing tiles of the grid, one thread each: a marked tile is appended to the list of the marked tiles and its mark taken back.
 * - `classifyClosureTiles`, indirect over that list: the classification of a tile (`CLASSIFY_TILE_STATEMENTS`, the same as the grid's) into the four lists the later kernels run over.
 *
 * A tile that holds no pixel of the closure is in no list: nothing of the closure is traced, resolved or cleared there. The kernels exist in the program of a record of several closures alone.
 */
export const CLOSURE_MARK_ENTRY = 'markClosureTiles'
export const CLOSURE_LIST_ENTRY = 'listClosureTiles'
export const CLOSURE_CLASSIFY_ENTRY = 'classifyClosureTiles'

/** The workgroup of the kernel that lists the marked tiles. */
const LIST_LANES = 64

const MARKED_LIST = listWgsl({
  name: 'markedOut',
  group: 0,
  binding: B.marked,
  entry: 'u32',
  append: true,
})

const kernels = () => `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.marks}) var<storage,read_write> closureMarks:array<atomic<u32>>;
/** The tiles of the grid across and down. */
fn closureTilesOfGrid()->vec2u{return (reflectionGridSize()+vec2u(${REFLECTION_SIDE - 1}u))/${REFLECTION_SIDE}u;}
@compute @workgroup_size(1)
fn ${CLOSURE_MARK_ENTRY}(@builtin(workgroup_id) group:vec3u){
 let overflow=overflowTileAt(group);
 if(overflow.z==0u){return;}
 let pixel=overflow.xy*${CLOSURE_TILE_SIZE}u;
 if(any(pixel>=reflectionViewport())){return;}
 let tile=pixel/(vec2u(${REFLECTION_SIDE}u)*reflectionBlock());
 let tiles=closureTilesOfGrid();
 if(all(tile<tiles)){atomicStore(&closureMarks[tile.y*tiles.x+tile.x],1u);}
}
@compute @workgroup_size(${LIST_LANES})
fn ${CLOSURE_LIST_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let tiles=closureTilesOfGrid();
 if(id.x>=tiles.x*tiles.y){return;}
 if(atomicExchange(&closureMarks[id.x],0u)!=0u){
  markedOut.entries[markedOutAppend(1u,1u)]=(id.x%tiles.x)|((id.x/tiles.x)<<16u);
 }
}
/** The tile of the workgroup, read by the first lane and told to all: the same value for the whole workgroup, so that what follows stays in uniform control flow. */
var<workgroup> closureListed:u32;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn ${CLOSURE_CLASSIFY_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){closureListed=reflectionTileOf(group,groups);}
 let listed=workgroupUniformLoad(&closureListed);
 if(listed==REFLECTION_NO_TILE){return;}
 let tile=vec2u(listed&0xffffu,listed>>16u);
${CLASSIFY_TILE_STATEMENTS}`

/** The program of the three kernels. */
export const closureClassifyWgsl = () =>
  wgslProgram(kernels(), [
    directLightWgsl(),
    LOBES_LIGHTING_WGSL,
    TOON_TABLES_NONE_WGSL,
    LOBES_DECODE_WGSL,
    REFLECTION_LAYER_WGSL,
    reflectionLightViewWgsl(REFLECTION_GROUP),
    REFLECTION_CLASSIFY_WGSL,
    overflowTilesBlock(B.overflow),
    MARKED_LIST,
  ])

const LABEL = 'Trillion3D reflection closure tiles'
/** The kernels of a device (over the layout of the reflection group), prepared off the frame. */
const programOf = oncePerDeviceKey((device: GPUDevice, group: GPUBindGroupLayout) => {
  const layouts = closureClassifyLayouts(device)
  const module = device.createShaderModule({ label: LABEL, code: closureClassifyWgsl() })
  const kernel = (own: GPUBindGroupLayout, entryPoint: string) =>
    preparedComputePipeline(device, {
      layout: device.createPipelineLayout({
        label: LABEL,
        bindGroupLayouts: [own, group],
      }),
      compute: { module, entryPoint },
    })
  return {
    layouts,
    mark: kernel(layouts.mark, CLOSURE_MARK_ENTRY),
    list: kernel(layouts.list, CLOSURE_LIST_ENTRY),
    classify: kernel(layouts.classify, CLOSURE_CLASSIFY_ENTRY),
  }
})

/** The kernels of a device once all three are compiled (asked until then): their pipelines and layouts. */
export function closureClassifyKernels(device: GPUDevice, group: GPUBindGroupLayout) {
  const program = programOf(device, group)
  const mark = program.mark.get(),
    list = program.list.get(),
    classify = program.classify.get()
  return mark && list && classify ? { mark, list, classify, layouts: program.layouts } : undefined
}

/** The groups of a closure's classification and what they were made over. */
interface Held {
  readonly list: GPUBuffer
  readonly normals: GPUTextureView
  readonly lobes: GPUTextureView
  readonly grids: object
  readonly groups: { mark: GPUBindGroup; list: GPUBindGroup; classify: GPUBindGroup }
}
const held = new WeakMap<ClosureSide, Held>()

/** The groups of the three kernels for the closure `side` (`ClosureSide`), made again when a resource they name is another: the mark over the closure's region of the overflow tiles' list, the list of the marked tiles, and the classification over the pixels of the closure (its flags, its normals and roughness, its lobes) into the lists of its grids. */
export function closureClassifyGroups(
  device: GPUDevice,
  layouts: ReturnType<typeof closureClassifyLayouts>,
  side: ClosureSide,
  normals: GPUTextureView,
  lobes: GPUTextureView,
  tiles: ClosureTiles,
) {
  const kept = held.get(side)
  const { grids } = side
  if (
    kept &&
    kept.list === tiles.list &&
    kept.normals === normals &&
    kept.lobes === lobes &&
    kept.grids === grids
  )
    return kept.groups
  const buffer = (b: GPUBuffer) => ({ buffer: b })
  const groups = {
    mark: device.createBindGroup({
      label: LABEL,
      layout: layouts.mark,
      entries: [
        {
          binding: B.overflow,
          resource: { buffer: tiles.list, ...closureRegionOf(tiles.tiles, side.closure) },
        },
        { binding: B.marks, resource: buffer(side.marks) },
      ],
    }),
    list: device.createBindGroup({
      label: LABEL,
      layout: layouts.list,
      entries: [
        { binding: B.marks, resource: buffer(side.marks) },
        { binding: B.marked, resource: buffer(side.marked) },
      ],
    }),
    classify: device.createBindGroup({
      label: LABEL,
      layout: layouts.classify,
      entries: [
        { binding: B.flags, resource: side.flagsView },
        { binding: B.normals, resource: normals },
        { binding: B.lobes, resource: lobes },
        { binding: B.tiles, resource: buffer(side.marked) },
        { binding: B.tracingOut, resource: buffer(grids.tracing) },
        { binding: B.clearTracingOut, resource: buffer(grids.clearTracing) },
        { binding: B.resolveOut, resource: buffer(grids.resolve) },
        { binding: B.clearOut, resource: buffer(grids.clear) },
      ],
    }),
  }
  held.set(side, { list: tiles.list, normals, lobes, grids, groups })
  return groups
}

/** The workgroups of the kernel that lists the marked tiles over a grid of `grid` texels. */
export const listGroups = (grid: readonly [number, number]) =>
  ceilDiv(ceilDiv(grid[0], REFLECTION_SIDE) * ceilDiv(grid[1], REFLECTION_SIDE), LIST_LANES)
