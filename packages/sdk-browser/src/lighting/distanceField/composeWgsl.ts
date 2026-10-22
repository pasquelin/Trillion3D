import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR } from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import { CLIP_FLAG_PARENT } from './clipmapBlock.ts'
import { clipmapCommonWgsl } from './clipmapCommonWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'
import { unorm8, unorm8Byte } from '../../../../math/src/wgsl/color.ts'

/**
 * THE COMPOSITION OF THE MESHES' FIELDS INTO THE PAGES. A group of 4 × 4 × 4 threads takes a quarter
 * of an eighth of a page — the page is 8 × 8 × 8 voxels, its 7 own and one of the filter's margin —,
 * a voxel to a thread. The placements of the page's cell of the culling grid are listed for the
 * group, those within the influence range of its box, 511 at a time; each thread takes the nearest
 * surface of the voxel's centre among them, within the range, each placement asked no farther than
 * what is nearest so far. With a static clipmap under it, the nearer of the voxel's distance and the
 * static page's.
 * The distance is stored as a byte, 0 to 255 over twice the range, the four voxels of a row in one
 * word of the atlas.
 */

const CONSTANTS = wgslConsts({
  CULL_FACTOR: GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR,
  FLAG_PARENT: CLIP_FLAG_PARENT,
})

/** The entry. */
export const COMPOSE_ENTRY = 'compositeObjectsIntoPages'

/** `compositeObjectsIntoPages`: the scene in group 0, the pass's own bindings in group 1. */
export const COMPOSE_SHADER = wgslProgram(
  `${CONSTANTS}
@group(1) @binding(1) var<storage,read> tiles:array<u32>;
@group(1) @binding(2) var<storage,read> cullGrid:array<u32>;
@group(1) @binding(3) var<storage,read_write> gdfPageAtlas:array<u32>;
@group(1) @binding(4) var combinedTable:texture_3d<u32>;
@group(1) @binding(5) var parentTable:texture_3d<u32>;
const TILE_OBJECTS:u32=511u;
var<workgroup> tileObjects:array<u32,511>;
var<workgroup> tileCount:atomic<u32>;
var<workgroup> cellObjects:u32;
var<workgroup> distances:array<u32,64>;
fn parentDistance(parent:GdfPage,texel:vec3u)->f32{
 let at=parent.index*512u+(texel.z*8u+texel.y)*8u+texel.x;
 let unit=unorm8(gdfPageAtlas[at>>2u],at&3u);
 return (unit*2.0-1.0)*clip.influenceRadius;
}
@compute @workgroup_size(4,4,4) fn ${COMPOSE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=(local.z*4u+local.y)*4u+local.x;
 let flat=group.x+group.y*n.x;
 let pageGrid=unpackTile(tiles[clip.tiles.y+flat/GDF_PAGE_GROUPS]);
 let part=flat%GDF_PAGE_GROUPS;
 let offset=vec3u(part%2u,(part/2u)%2u,part/4u);
 let texel=offset*4u+local;
 let translation=DfVec3(clip.translationHigh,clip.translationLow);
 let voxelCoord=vec3f(pageGrid)*f32(GDF_PAGE)+vec3f(texel)-GDF_PAGE_BORDER;
 let tileCoord=vec3f(pageGrid)*f32(GDF_PAGE)+vec3f(offset*4u)+1.5-GDF_PAGE_BORDER;
 let voxelWorld=dfSubtractFromFloat(voxelCoord*clip.pageToVoxelScale+clip.pageToVoxelBias,translation);
 let tileCentre=tileCoord*clip.pageToVoxelScale+clip.pageToVoxelBias;
 let tableCoord=pageTableCoord(pageGrid);
 let page=unpackGdfPage(textureLoad(combinedTable,tableCoord,0).x);
 let cell=pageGrid/vec3u(CULL_FACTOR);
 let header=clip.cullHeader+((cell.z*clip.cullGrid.y+cell.y)*clip.cullGrid.x+cell.x)*2u;
 if(thread==0u){cellObjects=cullGrid[header];}
 let objects=workgroupUniformLoad(&cellObjects);
 let start=cullGrid[header+1u];
 var nearest=clip.influenceRadius;
 for(var first=0u;first<objects;first+=TILE_OBJECTS){
  let last=first+min(objects-first,TILE_OBJECTS);
  if(thread==0u){atomicStore(&tileCount,0u);}
  workgroupBarrier();
  for(var k=first+thread;k<last;k+=64u){
   let object=cullGrid[clip.cullArray+start+k];
   let bounds=loadDfObjectBounds(object);
   let centre=dfToTranslated(bounds.center,translation);
   if(squaredDistanceBetweenBoxes(tileCentre,clip.composeTileExtent,centre,bounds.boxExtent)<clip.influenceRadiusSq){
    tileObjects[atomicAdd(&tileCount,1u)]=object;
   }
  }
  workgroupBarrier();
  let listed=atomicLoad(&tileCount);
  for(var k=0u;k<listed;k++){
   let reach=min(clip.influenceRadius,max(nearest,0.0));
   nearest=min(nearest,distanceToNearestSurfaceForObject(loadDfObjectData(tileObjects[k]),voxelWorld,reach));
  }
 }
 if((clip.flags&FLAG_PARENT)!=0u){
  let parent=unpackGdfPage(textureLoad(parentTable,tableCoord,0).x);
  if(parent.valid){nearest=min(nearest,parentDistance(parent,texel));}
 }
 distances[thread]=unorm8Byte(saturate(nearest/(2.0*clip.influenceRadius)+0.5));
 workgroupBarrier();
 if(local.x==0u&&page.valid){
  let row=thread;
  let word=distances[row]|(distances[row+1u]<<8u)|(distances[row+2u]<<16u)|(distances[row+3u]<<24u);
  gdfPageAtlas[page.index*128u+(texel.z*8u+texel.y)*2u+offset.x]=word;
 }
}`,
  [meshFieldWgsl(0), clipmapCommonWgsl(1, 0), squaredDistanceBetweenBoxes, unorm8, unorm8Byte],
)
