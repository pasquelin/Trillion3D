import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import {
  clipmapCommonWgsl,
  objectTileWalk,
  OBJECT_TILE_DECLS_WGSL,
  PARENT_DISTANCE_BUFFER_WGSL,
  PARENT_DISTANCE_TEXTURE_WGSL,
} from './clipmapCommonWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'
import { unorm8Byte } from '../../../../math/src/wgsl/color.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'

/**
 * THE COMPOSITION OF THE MESHES' FIELDS INTO THE PAGES. A group of 4 × 4 × 4 threads takes a quarter
 * of an eighth of a page — the page is 8 × 8 × 8 voxels, its 7 own and one of the filter's margin —,
 * a voxel to a thread. The placements of the page's cell of the culling grid are listed for the
 * group, those within the influence range of its box, 511 at a time; each thread takes the nearest
 * surface of the voxel's centre among them, within the range, each placement asked no farther than
 * what is nearest so far. With a static clipmap under it, the nearer of the voxel's distance and the
 * static page's.
 * The distance is stored as a byte, 0 to 255 over twice the range: a voxel to a thread, written to the
 * atlas as a texture (`textured`, the texture read and written in place, the static page's voxel
 * loaded from it), or the four voxels of a row gathered into one word of the atlas as a buffer.
 */

/** The entry. */
export const COMPOSE_ENTRY = 'compositeObjectsIntoPages'

/** What the two ways of keeping the atlas differ in: its binding, the voxel's store, the static page's distance. */
const ATLAS_BUFFER = {
  binding: '@group(1) @binding(3) var<storage,read_write> gdfPageAtlas:array<u32>;',
  shared: 'var<workgroup> distances:array<u32,64>;',
  store: ` distances[thread]=unorm8Byte(saturate(nearest/(2.0*clip.influenceRadius)+0.5));
 workgroupBarrier();
 if(local.x==0u&&page.valid){
  let row=thread;
  let word=distances[row]|(distances[row+1u]<<8u)|(distances[row+2u]<<16u)|(distances[row+3u]<<24u);
  gdfPageAtlas[page.index*128u+(texel.z*8u+texel.y)*2u+offset.x]=word;
 }`,
  deps: [PARENT_DISTANCE_BUFFER_WGSL, unorm8Byte],
}
const ATLAS_TEXTURE = {
  binding: '@group(1) @binding(3) var gdfAtlas:texture_storage_3d<r8unorm,read_write>;',
  shared: '',
  store: ` if(page.valid){
  let at=gdfAtlasOffset(page.index)*GDF_PAGE_IN_ATLAS+texel;
  textureStore(gdfAtlas,vec3i(at),vec4f(saturate(nearest/(2.0*clip.influenceRadius)+0.5),0.0,0.0,1.0));
 }`,
  deps: [TEXTURE_FORMATS_TIER1_WGSL, PARENT_DISTANCE_TEXTURE_WGSL],
}

/** `compositeObjectsIntoPages`: the scene in group 0, the pass's own bindings in group 1; the atlas a
 *  storage texture where `textured`, else a buffer. */
export function composeShader(textured: boolean) {
  const atlas = textured ? ATLAS_TEXTURE : ATLAS_BUFFER
  return wgslProgram(
    `@group(1) @binding(1) var<storage,read> tiles:array<u32>;
@group(1) @binding(2) var<storage,read> cullGrid:array<u32>;
${atlas.binding}
@group(1) @binding(4) var combinedTable:texture_3d<u32>;
@group(1) @binding(5) var parentTable:texture_3d<u32>;
${atlas.shared}
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
 var nearest=clip.influenceRadius;
${objectTileWalk({
  keep: 'squaredDistanceBetweenBoxes(tileCentre,clip.composeTileExtent,dfToTranslated(bounds.center,translation),bounds.boxExtent)<clip.influenceRadiusSq',
  each: `   let reach=min(clip.influenceRadius,max(nearest,0.0));
   nearest=min(nearest,distanceToNearestSurfaceForObject(loadDfObjectData(object),voxelWorld,reach));`,
})}
 if((clip.flags&FLAG_PARENT)!=0u){
  let parent=unpackGdfPage(textureLoad(parentTable,tableCoord,0).x);
  if(parent.valid){nearest=min(nearest,parentDistance(parent,texel));}
 }
${atlas.store}
}`,
    [
      meshFieldWgsl(0),
      clipmapCommonWgsl(1, 0),
      squaredDistanceBetweenBoxes,
      OBJECT_TILE_DECLS_WGSL,
      ...atlas.deps,
    ],
  )
}
