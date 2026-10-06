import { directLightWgsl } from '../direct/lightWgsl.ts'
import { GRID_BOUNDS_WGSL } from './boundsWgsl.ts'
import { GRID_COMPACT_WGSL, GRID_LANES } from './compactWgsl.ts'

/**
 * THE LIGHT GRID: cells of `tileSize` pixels across and `gridSlices` slices of
 * depth, a doubling of the view depth every `gridSlicesPerOctave` slices, each listing the lights
 * whose range meets it, and each pixel walking the list of the cell its depth falls in. The lights
 * are culled once per image against the cells' own bounds — never against the depths the image
 * holds, which the pass does not read —, so its cost follows the columns and the lights alone.
 *
 * One workgroup per column of cells, a lane per light of each batch of 64: a light out of the
 * column's planes meets none of its cells; any other meets a run of them, whose two ends are solved
 * from its sphere and the column's section (`./boundsWgsl.ts`). The runs become the cells' lists,
 * in the view's pool, each in increasing light order (`./compactWgsl.ts`); a cell's record holds
 * its count, the high bit set when a listed light holds a shadow slot, and where its list starts.
 *
 * The pass works in the frame of the eye rounded to f32 (`tileViewInverse`, `./tileFrame.ts`): its
 * corners are unprojected there, a light's centre is brought there by one subtraction, and the
 * render matrix's depth rows give a point there its depth. Depth is REVERSE-Z
 * (`../../camera/depthConvention.ts`): the near plane at one, the background at zero.
 */
export const LIGHT_TILES_SHADER = `
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,origin:vec4f,depthRows:array<vec4f,2>,}
@group(0) @binding(0) var<uniform> view:TileView;
@group(0) @binding(1) var<storage,read> lights:DirectLights;
@group(0) @binding(2) var<storage,read_write> tiles:array<u32>;
${directLightWgsl()}
${GRID_BOUNDS_WGSL}
${GRID_COMPACT_WGSL}
/** The light count, one bound for the whole workgroup. */
var<workgroup> lightCount:u32;
@compute @workgroup_size(${GRID_LANES},1,1)
fn lightTiles(@builtin(workgroup_id) cell:vec3u,@builtin(local_invocation_index) lane:u32){
 let column=gridColumn(cell.xy);
 if(lane==0u){lightCount=lights.count;cached=0u;resume=ALL_CACHED;}
 if(lane<2u){atomicStore(&keptLanes[lane],0u);atomicStore(&slotted[lane],0u);atomicStore(&full[lane],0u);}
 chunk[lane]=vec2u(0u,EMPTY_RUN);
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  counts[slice]=0u;atomicStore(&masks[slice*2u],0u);atomicStore(&masks[slice*2u+1u],0u);
 }
 let count=workgroupUniformLoad(&lightCount);
 // First walk: each light's run, counted in the slices it holds; the runs kept while they fit.
 for(var first=0u;first<count;first+=LANES){
  var entry=vec2u(first+lane,EMPTY_RUN);
  if(first+lane<count){entry=entryOf(column,first+lane);}
  markEntry(lane,entry);
  workgroupBarrier();
  countSlices(lane);
  let kept=countOneBits(atomicLoad(&keptLanes[0]))+countOneBits(atomicLoad(&keptLanes[1]));
  let fits=resume==ALL_CACHED&&cached+kept<=CACHE;
  if(fits){cacheEntry(lane,entry);}
  workgroupBarrier();
  if(lane==0u){
   if(fits){cached+=kept;}else if(resume==ALL_CACHED){resume=first;}
   atomicStore(&keptLanes[0],0u);atomicStore(&keptLanes[1],0u);atomicStore(&slotted[0],0u);atomicStore(&slotted[1],0u);
  }
  workgroupBarrier();
 }
 let span=laneRun(lane,GRID_SLICES);
 let before=roomBefore(lane,span);
 if(lane==0u){takeRoom();walked.y=cached;walked.z=select(resume,count,resume==ALL_CACHED);}
 let walk=workgroupUniformLoad(&walked);
 dealRoom(span,before,walk.w);
 workgroupBarrier();
 let base=(cell.y*u32(view.viewport.z)+cell.x)*GRID_SLICES*TILE_STRIDE;
 for(var slice=lane;slice<GRID_SLICES;slice+=LANES){
  tiles[base+slice*TILE_STRIDE]=counts[slice];tiles[base+slice*TILE_STRIDE+1u]=cursor[slice];
 }
 if(walk.x==0u){return;}
 // Second walk: the cached runs, then the lights past them tested again, written slice by slice.
 let held=walk.y;
 for(var at=0u;at<held;at+=LANES){
  var entry=vec2u(0u,EMPTY_RUN);
  if(at+lane<held){entry=cache[at+lane];}
  markEntry(lane,entry);
  workgroupBarrier();
  writeSlices(lane);
  workgroupBarrier();
 }
 for(var first=walk.z;first<count;first+=LANES){
  var entry=vec2u(first+lane,EMPTY_RUN);
  if(first+lane<count){entry=entryOf(column,first+lane);}
  markEntry(lane,entry);
  workgroupBarrier();
  writeSlices(lane);
  workgroupBarrier();
 }
}`
