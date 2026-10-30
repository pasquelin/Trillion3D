import { directLightWgsl } from '../direct/lightWgsl.ts'
import { GRID_BOUNDS_WGSL } from './boundsWgsl.ts'
import { gridCompactWgsl } from './compactWgsl.ts'
import { GRID_CULL_WGSL } from './cullWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

/** The pass's bindings and what its workgroup shares. `start` holds the word the records start at and,
 *  in `y`, the words a cell has of its own in the pool, 0 for the lists made by chains of links
 *  (the setting `lightGridLinkedLists`). */
const TILE_PASS_HEAD_TEXT = `
struct TileView{inverseViewProjection:mat4x4f,viewport:vec4f,origin:vec4f,depthRows:array<vec4f,2>,start:vec4u,cull:vec4f,sliceMap:vec3f,}
@group(0) @binding(0) var<uniform> view:TileView;
@group(0) @binding(1) var<storage,read> directLights:DirectLights;
@group(0) @binding(2) var<storage,read_write> tiles:array<u32>;
/** The slice map of this image (\`gridSlice\`), the buffer's head the CPU wrote (\`./gridMap.ts\`). */
fn gridMap()->vec3f{return bitcast<vec3f>(vec3u(tiles[0],tiles[1],tiles[2]));}
/** The light count and the column's last visible slice (\`columnReach\`), one bound for the whole workgroup. */
var<workgroup> lightCount:u32;
var<workgroup> reach:u32;`

/** The column's start: the workgroup's memory cleared and the light count read. */
const TILE_PASS_SETUP_TEXT = `@compute @workgroup_size(WORKGROUP_THREADS,1,1)
fn lightTiles(@builtin(workgroup_id) cell:vec3u,@builtin(local_invocation_index) lane:u32){
 var column=gridColumn(cell.xy);
 if(lane==0u){lightCount=directLights.count+directLights.simple;reach=columnReach(cell.xy);}
 if(lane<LANE_WORDS){atomicStore(&full[lane],0u);}
 chunk[lane]=vec2u(0u,EMPTY_RUN);
 for(var slice=lane;slice<COLUMN_SLICES;slice+=WORKGROUP_THREADS){
  counts[slice]=0u;heads[slice]=LINK_NONE;
  for(var word=0u;word<LANE_WORDS;word++){atomicStore(&masks[slice*LANE_WORDS+word],0u);}
 }
 let count=workgroupUniformLoad(&lightCount);
 column.reach=workgroupUniformLoad(&reach);`

/** The injection: each light's run, put in the cells it holds, batch after batch. */
const TILE_PASS_INJECT_TEXT = ` // Injection: each batch's lights put in the cells of their runs, in light order.
 let columnCell=(cell.y*u32(view.viewport.z)+cell.x)*COLUMN_SLICES;
 let perCell=view.start.y;
 let span=laneRun(lane,COLUMN_SLICES);
 for(var first=0u;first<count;first+=WORKGROUP_THREADS){
  var entry=vec2u(first+lane,EMPTY_RUN);
  if(first+lane<count){entry=entryOf(column,first+lane);}
  markEntry(lane,entry);
  workgroupBarrier();
  let before=linksBefore(lane,span);
  if(lane==0u){reserveLinks();}
  let base=workgroupUniformLoad(&linkBase);
  if(perCell==0u){
   pushLinks(span,base+before);
  }else{
   pushOwn(span,columnCell,perCell);
  }
  workgroupBarrier();
 }`

/** The compaction: the cells' chains written as lists, and the records. */
const TILE_PASS_COMPACT_TEXT = ` // Compaction: each cell's chain written as its list, and its record.
 let before=listsBefore(lane,span);
 if(lane==0u){reserveLists();}
 emitSlices(span,columnCell,view.start.x,perCell,pool.start+workgroupUniformLoad(&listBase)+before);
}`

/**
 * THE LIGHT GRID: cells of `tileSize` pixels across and `gridSlices` slices of
 * depth, spread by `gridDepthDistribution` (`./gridMap.ts`), each listing the lights
 * whose range meets it, and each pixel walking the list of the cell its depth falls in. The lights
 * are culled once per image against the cells' own bounds, and, in the view's grid, the cells no
 * pixel can read are left empty: those past the farthest depth the image holds in their column
 * (`./cullWgsl.ts`, the setting `lightGridHizCull`), read from the pyramid of the image's own
 * depth.
 *
 * One workgroup per column of cells, a lane per light of each batch of `WORKGROUP_THREADS`: a
 * light out of the column's planes meets none of its cells; any other meets a run of them, whose two ends are solved
 * from its sphere and the column's section (`./boundsWgsl.ts`). The runs become the cells' lists in
 * the view's pool (`./compactWgsl.ts`), in this order: the pool's counters cleared with its state
 * (`./pool.ts`), the lights injected into the cells as chains of links, the chains compacted into
 * contiguous lists, each in increasing light order; the pool's fixed capacity of links dropping the lights asked past it; a cell's record holds its
 * count, the high bit set when a listed light holds a shadow slot, and where its list starts.
 *
 * The pass works in the frame of the eye rounded to f32 (`tileViewInverse`, `./tileFrame.ts`): its
 * corners are unprojected there, a light's centre is brought there by one subtraction, and the
 * render matrix's depth rows give a point there its depth. Depth is REVERSE-Z
 * (`../../camera/depthConvention.ts`): the near plane at one, the background at zero.
 */
export const lightTilesShader = () =>
  wgslProgram(
    `${TILE_PASS_HEAD_TEXT}
${TILE_PASS_SETUP_TEXT}
${TILE_PASS_INJECT_TEXT}
${TILE_PASS_COMPACT_TEXT}`,
    [
      directLightWgsl(),
      gridCompactWgsl(LIGHT_SETTINGS.gridSlices),
      GRID_BOUNDS_WGSL,
      GRID_CULL_WGSL,
    ],
  )
