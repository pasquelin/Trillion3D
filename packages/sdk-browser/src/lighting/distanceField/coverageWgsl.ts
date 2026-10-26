import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { unorm8 } from '../../../../math/src/wgsl/color.ts'
import {
  GLOBAL_DISTANCE_FIELD_COVERAGE_DOWNSAMPLE_FACTOR,
  GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'
import { squaredDistanceBetweenBoxes } from './aabbWgsl.ts'
import {
  clipmapCommonWgsl,
  objectTileWalk,
  OBJECT_TILE_DECLS_WGSL,
  PARENT_DISTANCE_BUFFER_WGSL,
  PARENT_DISTANCE_TEXTURE_WGSL,
} from './clipmapCommonWgsl.ts'
import { meshFieldWgsl } from './meshFieldWgsl.ts'

/**
 * THE COVERAGE OF THE PAGES. A ray marched through the field expands the surface it meets by less, and
 * steps further, where only two-sided meshes (foliage, thin cloth) reach: a voxel has a coverage of 0
 * there, 1 where a one-sided mesh does or none. The coverage atlas holds it, 4 × 4 × 4 bytes a page, and the
 * page's top bit says that a voxel of the page has none (`globalReadWgsl.ts`).
 *
 * A group of 4 × 4 × 4 threads takes one page just composited, a thread the voxel of every second texel
 * of the page along each axis (the coverage lattice). The placements of the page's cell of the
 * culling grid are listed for the group, those within the influence range of the page's box, 511 at a
 * time; a thread asks how far the surface of each lies from its voxel, within the influence range: a
 * placement nearer than the range (four voxels) makes the voxel reached by two-sided meshes if the
 * placement is mostly two-sided, by one-sided meshes if it is not. With a static clipmap under it, the
 * static page's voxel counts the same way when its distance is within the range, as two-sided where
 * its own coverage, in the coverage atlas, is under a half. A voxel reached by two-sided meshes and by no
 * one-sided mesh has a coverage of 0 and one such voxel sets the page's flag, none clears it: the flag
 * is the group's single thread's write of the page's word of the table `pageTable`, the page's index
 * kept. The coverage bytes are gathered four to a word, one row of the lattice, into the page's 16
 * words of the coverage atlas, in the page atlas's buffer (`gdfPageAtlas`, from the word `coverageBase()`: past
 * the pages' bytes, or the buffer's first word where the pages are a texture, `textured`, which the
 * static page's distance is then read from, read only).
 */

const CONSTANTS = wgslConsts({
  COVERAGE_FACTOR: GLOBAL_DISTANCE_FIELD_COVERAGE_DOWNSAMPLE_FACTOR,
  COVERAGE_IN_ATLAS: GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS,
})

/** The entry. */
export const COVERAGE_ENTRY = 'markPageCoverage'

/** The bindings and the workgroup's memory of the coverage kernel. */
const coverageDeclarations = (textured: boolean) => `${CONSTANTS}
@group(1) @binding(1) var<storage,read> tiles:array<u32>;
@group(1) @binding(2) var<storage,read> cullGrid:array<u32>;
${
  textured
    ? '@group(1) @binding(3) var gdfAtlas:texture_storage_3d<r8unorm,read>;'
    : '@group(1) @binding(3) var<storage,read_write> gdfPageAtlas:array<u32>;'
}
@group(1) @binding(4) var parentTable:texture_3d<u32>;
@group(1) @binding(5) var pageTable:texture_storage_3d<r32uint,read_write>;
${textured ? '@group(1) @binding(6) var<storage,read_write> gdfPageAtlas:array<u32>;' : ''}
fn coverageBase()->u32{return ${textured ? '0u' : 'clip.maxPages*128u'};}
var<workgroup> uncovered:atomic<u32>;
var<workgroup> voxels:array<u32,64>;`

/** The kernel itself: a group a page, its voxels marked covered or not. */
const coverageKernel = `@compute @workgroup_size(4,4,4) fn ${COVERAGE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=(local.z*4u+local.y)*4u+local.x;
 let pageGrid=unpackTile(tiles[clip.tiles.y+group.x+group.y*n.x]);
 let tableCoord=pageTableCoord(pageGrid);
 let own=textureLoad(pageTable,tableCoord).x;
 let texel=local*COVERAGE_FACTOR;
 let translation=DfVec3(clip.translationHigh,clip.translationLow);
 let voxelCoord=vec3f(pageGrid)*f32(GDF_PAGE)+vec3f(texel)-GDF_PAGE_BORDER;
 let voxelWorld=dfSubtractFromFloat(voxelCoord*clip.pageToVoxelScale+clip.pageToVoxelBias,translation);
 let centre=vec3f(pageGrid)*clip.pageToPageScale+clip.pageToPageBias;
 var twoSided=false;
 var oneSided=false;
${objectTileWalk({
  leader: '\n  atomicStore(&uncovered,0u);',
  keep: 'squaredDistanceBetweenBoxes(centre,clip.pageWorldExtent,dfToTranslated(bounds.center,translation),bounds.boxExtent)<clip.influenceRadiusSq',
  each: `   let data=loadDfObjectData(object);
   if(abs(distanceToNearestSurfaceForObject(data,voxelWorld,clip.influenceRadius))<clip.influenceRadius){
    if(data.mostlyTwoSided){twoSided=true;}else{oneSided=true;}
   }`,
})}
 if((clip.flags&FLAG_PARENT)!=0u){
  let parent=unpackGdfPage(textureLoad(parentTable,tableCoord,0).x);
  if(parent.valid&&abs(parentDistance(parent,texel))<clip.influenceRadius){
   let word=gdfPageAtlas[coverageBase()+(parent.index*COVERAGE_IN_ATLAS+local.z)*COVERAGE_IN_ATLAS+local.y];
   if(unorm8(word,local.x)<0.5){twoSided=true;}else{oneSided=true;}
  }
 }
 let covered=!(twoSided&&!oneSided);
 voxels[thread]=select(0u,255u,covered);
 if(!covered){atomicOr(&uncovered,1u);}
 workgroupBarrier();
 if(own==GDF_INVALID_PAGE){return;}
 if(local.x==0u){
  let row=((own&0x00FFFFFFu)*COVERAGE_IN_ATLAS+local.z)*COVERAGE_IN_ATLAS+local.y;
  gdfPageAtlas[coverageBase()+row]=voxels[thread]|(voxels[thread+1u]<<8u)|(voxels[thread+2u]<<16u)|(voxels[thread+3u]<<24u);
 }
 if(thread!=0u){return;}
 let flagged=atomicLoad(&uncovered)!=0u;
 textureStore(pageTable,tableCoord,vec4u(select(own&~GDF_COVERAGE_BIT,own|GDF_COVERAGE_BIT,flagged)));
}`

/** `markPageCoverage`: the scene in group 0, the pass's own bindings in group 1; a group a page, the
 *  composed pages listed in `tiles`. */
export function coverageShader(textured: boolean) {
  return wgslProgram([coverageDeclarations(textured), coverageKernel].join('\n'), [
    meshFieldWgsl(0),
    clipmapCommonWgsl(1, 0),
    squaredDistanceBetweenBoxes,
    OBJECT_TILE_DECLS_WGSL,
    unorm8,
    ...(textured
      ? [TEXTURE_FORMATS_TIER1_WGSL, PARENT_DISTANCE_TEXTURE_WGSL]
      : [PARENT_DISTANCE_BUFFER_WGSL]),
  ])
}
