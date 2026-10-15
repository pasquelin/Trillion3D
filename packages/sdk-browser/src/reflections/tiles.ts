import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../gpu/core/computeBindings.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_BLOCK_PIXEL_WGSL } from './constantsWgsl.ts'
import { listWgsl } from '../gpu/dispatch/list.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'

/**
 * THE TILES A SURFACE'S REFLECTIONS RUN OVER, listed on the GPU every image (`REFLECTION_CLASSIFY_SHADER`):
 * a workgroup a tile of `REFLECTION_SIDE`² grid texels (`grids.ts`) reads its blocks' pixels' flags; a tile where one reflects is
 * listed — its count added at the list's head, and the workgroups the
 * indirect dispatch takes raised to hold it —, and every kernel after it (`trace.ts`) is dispatched
 * indirectly over the listed tiles alone (`reflectionTilePixel`): no thread for a tile that does not
 * reflect, a row's last workgroups past the count returning at once, no read back, the CPU writing the
 * list's head each image (`../gpu/dispatch/list.ts`; `grids.ts`, whose grids hold the list). A tile left out has
 * its fresh texels and its scratch cleared, so no kernel reads there a texel of an earlier image: its
 * history this image is none, the last image's accumulation found its own. The classification also
 * tells the settle the image traced a pixel (`classifySampled`, `settle.ts`): a flag, every writer
 * writing one.
 *
 * Cost: a thread a grid texel, a flag read for each of its block's pixels until one reflects, a cleared
 * texel twice on a tile that does not reflect; a word and three atomics a listed tile.
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
  `@group(0) @binding(${C.flags}) var classifyFlags:texture_2d<u32>;
@group(0) @binding(${C.fresh}) var classifyFresh:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${C.scratch}) var classifyScratch:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
@group(0) @binding(${C.sampled}) var<storage,read_write> classifySampled:u32;
var<workgroup> tileReflects:u32;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let coord=tile.xy*${REFLECTION_SIDE}u+local.xy;
 let inside=all(coord<textureDimensions(classifyFresh));
 // A grid texel reflects where a pixel of its block does.
 for(var k=0u;inside&&k<REFLECTION_TRACE_BLOCK*REFLECTION_TRACE_BLOCK;k++){
  let pixel=reflectionBlockPixel(coord,k);
  if(all(pixel<textureDimensions(classifyFlags))&&surfaceReflects(textureLoad(classifyFlags,pixel,0).r)){tileReflects=1u;break;}
 }
 let reflects=workgroupUniformLoad(&tileReflects);
 if(reflects==0u){
  if(inside){textureStore(classifyFresh,coord,vec4u(0u));textureStore(classifyScratch,coord,vec4u(0u));}
  return;
 }
 if(lane==0u){
  listed.entries[listedAppend(1u,1u)]=tile.x|(tile.y<<16u);
  classifySampled=1u;
 }
}`,
  [
    surfaceReflects,
    REFLECTION_BLOCK_PIXEL_WGSL,
    listWgsl({ name: 'listed', group: 0, binding: C.list, entry: 'u32', append: true }),
  ],
)
