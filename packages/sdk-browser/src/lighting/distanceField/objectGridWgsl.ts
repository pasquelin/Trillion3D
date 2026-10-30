import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import { clipmapCommonWgsl, objectTileWalk, OBJECT_TILE_DECLS_WGSL } from './clipmapCommonWgsl.ts'
import { globalDistanceFieldReadWgsl } from './globalReadWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'

/**
 * THE OBJECT GRID OF THE GLOBAL DISTANCE FIELD: beside the pages' distances, for each page, 4 × 4 × 4
 * cells of 2 voxels along each axis, each holding the four objects nearest to it — the cell's word
 * of four: the object's row among the scene's placements (`DfObjectData.instance`) in the low 24 bits
 * and in the top 8 its distance to the cell's centre, 0 to 255 over from a quarter of the cell's
 * extent under zero to the farthest it is asked (`gdfGridPack`), so that sorted words are sorted by
 * distance; all ones for a place not taken. A ray that meets the field finds, in the cell its hit
 * lies in, the objects whose surface it should read (`gdfObjectGridCellAt`). Built only while rays are
 * marched through the field, for each page just composited.
 *
 * THE COMPOSITION. A group of 4 × 4 × 4 threads takes a page, a thread a cell. The page's cell of the
 * culling grid lists its placements; those whose box lies within 1.44 of the page's extent plus
 * the range its cards reach (3 voxel extents, `GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS`)
 * of the page are kept, 511 at a time; a thread takes of them those whose box is within that range
 * of its cell, asks the distance of each to the cell's centre, no farther than 1.44 of the cell's
 * extent plus the range, and keeps the four nearest (`gdfGridAdd`: a nearer object replaces the
 * farthest held). Each cell is then sorted. With a static clipmap under it, a cell begins with the
 * static page's cell, so that the movable meshes add to it. The cell's place in the buffer is the
 * page's index times 64 plus the cell's place in a Z order of the three coordinates (`gdfGridCellOffset`).
 */

const GRID_CONSTANTS = wgslConsts({
  GDF_GRID_RESOLUTION: GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION,
  GDF_GRID_STRIDE: GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION ** 3,
  GDF_GRID_INVALID: 0xffffffff,
})

/** The words of a cell and its functions, shared by the composition and the read. */
const OBJECT_GRID_WGSL = wgslBlock(
  'OBJECT_GRID_WGSL',
  [],
  `
${GRID_CONSTANTS}
fn gdfGridCellEmpty()->vec4u{return vec4u(GDF_GRID_INVALID);}
fn gdfGridValid(packed:u32)->bool{return packed<GDF_GRID_INVALID;}
fn gdfGridInstance(packed:u32)->u32{return packed&0xFFFFFFu;}
fn gdfGridPack(instance:u32,distance:f32,cellExtent:f32,maxQuery:f32)->u32{
 let unit=saturate((distance+0.25*cellExtent)/(maxQuery+0.25*cellExtent));
 return (instance&0xFFFFFFu)|(u32(clamp(unit*256.0,0.0,255.0))<<24u);
}
fn gdfGridAdd(cell:vec4u,instance:u32,distance:f32,cellExtent:f32,maxQuery:f32)->vec4u{
 if(abs(distance)>=maxQuery){return cell;}
 let packed=gdfGridPack(instance,distance,cellExtent,maxQuery);
 let largest=max(max(cell.x,cell.y),max(cell.z,cell.w));
 var out=cell;
 if(packed<largest){
  for(var k=0u;k<${GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE}u;k++){
   if(out[k]==largest){out[k]=packed;break;}
  }
 }
 return out;
}
fn gdfGridSort(cell:vec4u)->vec4u{
 var out=cell;
 for(var sweep=0u;sweep<${GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE - 1}u;sweep++){
  for(var k=0u;k<${GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE - 1}u-sweep;k++){
   let low=min(out[k],out[k+1u]);
   let high=max(out[k],out[k+1u]);
   out[k]=low;
   out[k+1u]=high;
  }
 }
 return out;
}
fn gdfGridCellOffset(cell:vec3u)->u32{
 let low=(cell&vec3u(1u))*vec3u(1u,2u,4u);
 let high=((cell>>vec3u(1u))&vec3u(1u))*vec3u(8u,16u,32u);
 return low.x+low.y+low.z+high.x+high.y+high.z;
}`,
)

/** The entry. */
export const OBJECT_GRID_ENTRY = 'compositeObjectsIntoObjectGridPages'

/** `compositeObjectsIntoObjectGridPages`: the scene in group 0, the pass's own bindings in group 1; a group
 *  a page, the composed pages listed in `tiles`, `ownTable` the cache's own page table and `parentTable`
 *  the static cache's. */
export const OBJECT_GRID_SHADER = wgslProgram(
  `const GRID_RANGE:f32=${GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS}.0;
@group(1) @binding(1) var<storage,read> tiles:array<u32>;
@group(1) @binding(2) var<storage,read> cullGrid:array<u32>;
@group(1) @binding(3) var<storage,read_write> objectGrid:array<vec4u>;
@group(1) @binding(4) var ownTable:texture_3d<u32>;
@group(1) @binding(5) var parentTable:texture_3d<u32>;
@compute @workgroup_size(4,4,4) fn ${OBJECT_GRID_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=(local.z*4u+local.y)*4u+local.x;
 let pageGrid=unpackTile(tiles[clip.tiles.y+group.x+group.y*n.x]);
 let place=gdfGridCellOffset(local);
 let tableCoord=pageTableCoord(pageGrid);
 let page=unpackGdfPage(textureLoad(ownTable,tableCoord,0).x);
 let translation=DfVec3(clip.translationHigh,clip.translationLow);
 let cellCoord=vec3f(pageGrid)*f32(GDF_PAGE)+vec3f(local)*2.0+0.5-GDF_PAGE_BORDER;
 let cellCentre=cellCoord*clip.pageToVoxelScale+clip.pageToVoxelBias;
 let cellWorld=dfSubtractFromFloat(cellCentre,translation);
 let cellExtent=clip.voxelExtent*f32(GDF_PAGE)/f32(GDF_GRID_RESOLUTION);
 let range=GRID_RANGE*clip.voxelExtent;
 let maxQuery=1.44*cellExtent+range;
 let tileCoord=vec3f(pageGrid)*f32(GDF_PAGE)+2.0*(f32(GDF_PAGE)/f32(GDF_GRID_RESOLUTION));
 let tileCentre=tileCoord*clip.pageToVoxelScale+clip.pageToVoxelBias;
 let tileExtent=clip.voxelExtent*f32(GDF_PAGE);
 let tileQuery=1.44*tileExtent+range;
 var cell=gdfGridCellEmpty();
 if((clip.flags&FLAG_PARENT)!=0u){
  let parent=unpackGdfPage(textureLoad(parentTable,tableCoord,0).x);
  let at=GDF_GRID_STRIDE*parent.index+place;
  if(parent.valid&&at<arrayLength(&objectGrid)){cell=objectGrid[at];}
 }
${objectTileWalk({
  keep: 'squaredDistanceBetweenBoxes(tileCentre,vec3f(tileExtent),dfToTranslated(bounds.center,translation),bounds.boxExtent)<tileQuery*tileQuery',
  each: `   let bounds=loadDfObjectBounds(object);
   let apart=squaredDistanceBetweenBoxes(cellCentre,vec3f(cellExtent),dfToTranslated(bounds.center,translation),bounds.boxExtent);
   if(apart<=range*range){
    let data=loadDfObjectData(object);
    cell=gdfGridAdd(cell,data.instance,distanceToNearestSurfaceForObject(data,cellWorld,maxQuery),cellExtent,maxQuery);
   }`,
})}
 let at=GDF_GRID_STRIDE*page.index+place;
 if(page.valid&&at<arrayLength(&objectGrid)){objectGrid[at]=gdfGridSort(cell);}
}`,
  [
    meshFieldWgsl(0),
    clipmapCommonWgsl(1, 0),
    squaredDistanceBetweenBoxes,
    OBJECT_TILE_DECLS_WGSL,
    OBJECT_GRID_WGSL,
  ],
)

/**
 * The object grid's read, for what reads the global field (`globalReadWgsl.ts`, its bindings from `first` of
 * the group `group`) and binds the grid at `binding`: `gdfObjectGridCellAt(p, clipmap, cells)`, the four words
 * of the cell of the page that holds the translated position `p` in the clipmap `clipmap`, the cell's place
 * in the page found from the position's place among the clipmap's pages, all ones where no page holds it or
 * the grid, `cells` long (`arrayLength(&gdfObjectGrid)`), does not reach it; `gdfObjectGridCellOf(p, clipmap)`
 * the same of the grid bound. A word is valid where `gdfGridValid`, its object `gdfGridInstance`.
 */
export function globalObjectGridReadWgsl(
  group: number,
  first: number,
  binding: number,
  filterableMip: boolean,
) {
  return wgslBlock(
    `GLOBAL_OBJECT_GRID_READ_WGSL ${group}, ${first}, ${binding}, ${filterableMip}`,
    [globalDistanceFieldReadWgsl(group, first, filterableMip), OBJECT_GRID_WGSL],
    `
@group(${group}) @binding(${binding}) var<storage,read> gdfObjectGrid:array<vec4u>;
fn gdfObjectGridCellAt(p:vec3f,clipmap:u32,cells:u32)->vec4u{
 let uv=gdfVolumeUv(p,clipmap);
 let page=gdfPageAt(uv,clipmap);
 let inPage=vec3u(fract(fract(saturate(uv)*f32(gdfView.pagesAlong)))*f32(GDF_GRID_RESOLUTION));
 let at=GDF_GRID_STRIDE*page.page+gdfGridCellOffset(inPage);
 if(!page.valid||at>=cells){return gdfGridCellEmpty();}
 return gdfObjectGrid[at];
}
fn gdfObjectGridCellOf(p:vec3f,clipmap:u32)->vec4u{return gdfObjectGridCellAt(p,clipmap,arrayLength(&gdfObjectGrid));}`,
  )
}
