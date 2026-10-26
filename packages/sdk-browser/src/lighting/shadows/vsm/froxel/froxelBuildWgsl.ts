/**
 * THE FROXELS OF THE DEPTH (`froxelGrid.ts`): one workgroup a tile of 8 × 8 pixels, a thread a pixel.
 * Each reads its depth and takes its slice (`vsmFroxelSlice`; no slice for the infinitely far, nor for
 * a pixel past the view); the slices of a tile are told apart in workgroup memory, and the first
 * thread of each slice appends the froxel to the list, counted by one atomic (`froxelCount`). The
 * reference reduces the 2×2 depths of the depth pyramid's first level to the same froxels, through a
 * hash of the slices; the froxels are the same, their order in the list is not. A froxel past the
 * list's room (`VsmFroxelGrid.capacity`) is counted and not written (`vsmFroxelArgs` holds the count to it).
 *
 * The list is one buffer of words (`FROXEL_LIST_HEADER_WORDS`, the marking's stage binds eight storage
 * buffers already): its first word the count, its second the count held to the room, then the froxels,
 * two words each (the tile's x | y << 16, the slice).
 * Group 0 of the build: 0 the depth, 1 the grid (uniform), 2 the list (rw, atomic).
 * Group 0 of the arguments' kernel: 0 the grid, 1 the list (rw), 2 the indirect arguments (rw).
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { GROUP_GRID_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import {
  FROXEL_LIST_HEADER_WORDS,
  FROXEL_MARK_GROUP,
  FROXEL_TILE_SIZE,
  VSM_FROXEL_GRID_WGSL,
} from './froxelGrid.ts'

export const FROXEL_BUILD_ENTRY = 'vsmBuildFroxels'
export const FROXEL_ARGS_ENTRY = 'vsmFroxelArgs'

/** The build of the froxels of the depth. */
export const FROXEL_BUILD_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var froxelDepth:texture_depth_2d;
@group(0) @binding(1) var<uniform> froxelGrid:VsmFroxelGrid;
@group(0) @binding(2) var<storage,read_write> froxelList:array<atomic<u32>>;
var<workgroup> tileSlices:array<i32,${FROXEL_TILE_SIZE * FROXEL_TILE_SIZE}>;
@compute @workgroup_size(${FROXEL_TILE_SIZE},${FROXEL_TILE_SIZE})
fn ${FROXEL_BUILD_ENTRY}(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let pixel=tile.xy*${FROXEL_TILE_SIZE}u+local.xy;
 var slice=FROXEL_INVALID_SLICE;
 if(all(pixel<froxelGrid.viewSize)){
  let deviceZ=textureLoad(froxelDepth,vec2i(froxelGrid.viewRectMin+pixel),0);
  // The infinitely far (device depth 0 of a perspective view) has no slice.
  if(deviceZ!=0.0||froxelGrid.isOrtho!=0u){
   slice=vsmFroxelSlice(vsmFroxelViewDepth(deviceZ));
  }
 }
 tileSlices[lane]=slice;
 workgroupBarrier();
 // The first thread of each slice of the tile appends its froxel.
 var first=slice!=FROXEL_INVALID_SLICE;
 for(var other=0u;other<lane;other++){
  if(tileSlices[other]==slice){first=false;}
 }
 if(first){
  let at=atomicAdd(&froxelList[0],1u);
  if(at<froxelGrid.capacity){
   let packed=vsmFroxelPack(tile.xy,slice);
   atomicStore(&froxelList[${FROXEL_LIST_HEADER_WORDS}u+2u*at],packed.xy);
   atomicStore(&froxelList[${FROXEL_LIST_HEADER_WORDS}u+2u*at+1u],bitcast<u32>(packed.z));
  }
 }
}
`,
  [VSM_FROXEL_GRID_WGSL],
)

/** The indirect arguments of the marking over the froxels: its groups of `FROXEL_MARK_GROUP`
 *  threads in rows, and the count held to the list's room. */
export const FROXEL_ARGS_WGSL = wgslProgram(
  /* wgsl */ `
@group(0) @binding(0) var<uniform> froxelGrid:VsmFroxelGrid;
@group(0) @binding(1) var<storage,read_write> froxelList:array<u32>;
@group(0) @binding(2) var<storage,read_write> froxelArgs:array<u32>;
@compute @workgroup_size(1) fn ${FROXEL_ARGS_ENTRY}(){
 let held=min(froxelList[0],froxelGrid.capacity);
 froxelList[1]=held;
 let grid=groupGrid(ceilDiv(held,${FROXEL_MARK_GROUP}u));
 froxelArgs[0]=grid.x;
 froxelArgs[1]=grid.y;
 froxelArgs[2]=1u;
}
`,
  [VSM_FROXEL_GRID_WGSL, GROUP_GRID_WGSL, ceilDivWgsl],
)
