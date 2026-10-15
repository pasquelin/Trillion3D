import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../gpu/core/computeBindings.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { REFLECTION_SIDE, REFLECTION_TILE_ROW } from './constants.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'

/**
 * THE TILES A SURFACE'S REFLECTIONS RUN OVER, listed on the GPU every image (`REFLECTION_CLASSIFY_SHADER`):
 * a workgroup a tile of `REFLECTION_SIDE`² pixels reads its pixels' flags; a tile where one reflects is
 * listed — its count added at the list's head, and the rows of `REFLECTION_TILE_ROW` workgroups the
 * indirect dispatch takes raised to hold it —, and every kernel after it (`trace.ts`) is dispatched
 * indirectly over the listed tiles alone (`reflectionTilePixel`): no thread for a tile that does not
 * reflect, a row's last workgroups past the count returning at once, no read back, the CPU writing the
 * list's head each image (`resetTileList`, `grids.ts`, whose grids hold the list). A tile left out has
 * its fresh texels and its scratch cleared, so no kernel reads there a texel of an earlier image: its
 * history this image is none, the last image's accumulation found its own. The classification also
 * tells the settle the image traced a pixel (`classifySampled`, `settle.ts`): a flag, every writer
 * writing one.
 *
 * Cost: a thread a pixel, one flag read, a cleared texel twice on a tile that does not reflect; a word
 * and two atomics a listed tile; fewer than `REFLECTION_TILE_ROW` empty workgroups a kernel.
 */

/** The classification's group: the surface's flags, the list, the cleared grids and the settle's word. */
export const CLASSIFY_BINDINGS = { flags: 0, list: 1, fresh: 2, scratch: 3, sampled: 4 } as const
const C = CLASSIFY_BINDINGS

/** The classification's layout. */
export const classifyLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      computeTextureEntry(C.flags, 'uint'),
      computeBufferEntry(C.list, 'storage'),
      computeStorageTextureEntry(C.fresh, REFLECTION_GRID_FORMAT),
      computeStorageTextureEntry(C.scratch, REFLECTION_GRID_FORMAT),
      computeBufferEntry(C.sampled, 'storage'),
    ],
  })

/** The workgroups of the classification over a view of `size`: one a tile. */
export const classifyGroups = (size: readonly [number, number]) =>
  [ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE)] as const

export const REFLECTION_CLASSIFY_SHADER = wgslProgram(
  `struct ReflectionTileList{row:u32,rows:atomic<u32>,one:u32,count:atomic<u32>,tiles:array<u32>,}
@group(0) @binding(${C.flags}) var classifyFlags:texture_2d<u32>;
@group(0) @binding(${C.list}) var<storage,read_write> classifyList:ReflectionTileList;
@group(0) @binding(${C.fresh}) var classifyFresh:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${C.scratch}) var classifyScratch:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${C.sampled}) var<storage,read_write> classifySampled:u32;
var<workgroup> tileReflects:u32;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let coord=tile.xy*${REFLECTION_SIDE}u+local.xy;
 let inside=all(coord<textureDimensions(classifyFresh))&&all(coord<textureDimensions(classifyFlags));
 if(inside&&surfaceReflects(textureLoad(classifyFlags,coord,0).r)){tileReflects=1u;}
 let reflects=workgroupUniformLoad(&tileReflects);
 if(reflects==0u){
  if(inside){textureStore(classifyFresh,coord,vec4u(0u));textureStore(classifyScratch,coord,vec4u(0u));}
  return;
 }
 if(lane==0u){
  let at=atomicAdd(&classifyList.count,1u);
  classifyList.tiles[at]=tile.x|(tile.y<<16u);
  atomicMax(&classifyList.rows,at/${REFLECTION_TILE_ROW}u+1u);
  classifySampled=1u;
 }
}`,
  [surfaceReflects],
)
