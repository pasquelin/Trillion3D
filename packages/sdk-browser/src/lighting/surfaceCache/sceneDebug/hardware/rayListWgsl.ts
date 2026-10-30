import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import {
  HARDWARE_DISPATCH_X,
  HARDWARE_PARAMS,
  HARDWARE_RAYS_AT,
  HARDWARE_RAY_GROUP,
  HARDWARE_TILE,
} from './layout.ts'

/** The bindings of the kernels that list the tiles and the rays: the parameters, the list of tiles, the list of rays. */
export const RAY_LIST_BINDINGS = { params: 0, tiles: 1, rays: 2 } as const
const B = RAY_LIST_BINDINGS

export const RAY_LIST_ENTRIES = ['hardwareCreateTiles', 'hardwareCreateRays'] as const

/** The layout of the kernels' group 0. */
export const rayListLayoutEntries = () => [
  computeBufferEntry(B.params, 'uniform'),
  computeBufferEntry(B.tiles, 'storage'),
  computeBufferEntry(B.rays, 'storage'),
]

/**
 * THE TILES AND THE RAYS OF A DRAW. `hardwareCreateTiles`: a group for each tile of 8 by 8 pixels of the draw; the tile that holds a pixel inside the draw is appended to the list of tiles
 * (the count in its first word, a tile a word: its column in the low half, its row in the high). `hardwareCreateRays`: a group of 64 threads for each listed tile, a thread for each of its pixels,
 * appends the pixel inside the draw to the list of rays (the count in the first word of the buffer, a ray a word from `HARDWARE_RAYS_AT`: the column in the low half, the row in the high);
 * the group takes its place in the list with one add of its rays.
 */
export const rayListWgsl = wgslProgram(
  `${HARDWARE_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> scene:HardwareParams;
@group(0) @binding(${B.tiles}) var<storage,read_write> tiles:array<atomic<u32>>;
@group(0) @binding(${B.rays}) var<storage,read_write> work:array<atomic<u32>>;
var<workgroup> tileNeedsTracing:atomic<u32>;
@compute @workgroup_size(${HARDWARE_TILE},${HARDWARE_TILE},1)
fn ${RAY_LIST_ENTRIES[0]}(@builtin(workgroup_id) groupId:vec3u,@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&tileNeedsTracing,0u);}
 workgroupBarrier();
 if(all(id.xy<scene.size.xy)){atomicStore(&tileNeedsTracing,1u);}
 workgroupBarrier();
 if(lane==0u&&atomicLoad(&tileNeedsTracing)>0u){
  let at=atomicAdd(&tiles[0],1u);
  atomicStore(&tiles[1u+at],((groupId.y&0xffffu)<<16u)|(groupId.x&0xffffu));
 }
}
var<workgroup> groupRays:atomic<u32>;
var<workgroup> groupOffset:u32;
var<workgroup> groupRay:array<u32,${HARDWARE_RAY_GROUP}>;
@compute @workgroup_size(${HARDWARE_RAY_GROUP},1,1)
fn ${RAY_LIST_ENTRIES[1]}(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&groupRays,0u);}
 workgroupBarrier();
 let linear=groupId.y*${HARDWARE_DISPATCH_X}u+groupId.x;
 if(linear<atomicLoad(&tiles[0])){
  let tile=atomicLoad(&tiles[1u+linear]);
  let coord=vec2u(tile&0xffffu,tile>>16u)*${HARDWARE_TILE}u+vec2u(lane%${HARDWARE_TILE}u,lane/${HARDWARE_TILE}u);
  if(all(coord<scene.size.xy)){
   let at=atomicAdd(&groupRays,1u);
   groupRay[at]=(coord.x&0xffffu)|((coord.y&0xffffu)<<16u);
  }
 }
 workgroupBarrier();
 if(lane==0u){groupOffset=atomicAdd(&work[0],atomicLoad(&groupRays));}
 workgroupBarrier();
 if(lane<atomicLoad(&groupRays)){atomicStore(&work[${HARDWARE_RAYS_AT}u+groupOffset+lane],groupRay[lane]);}
}`,
  [],
)
