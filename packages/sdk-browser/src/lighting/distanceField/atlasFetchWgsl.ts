import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unorm8 } from '../../../../math/src/wgsl/color.ts'
import {
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION as PAGE,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS as IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S PAGE ATLAS, READ. The atlas is a buffer of bytes, 8 × 8 × 8 to a page, a
 * page after the other, each voxel's distance mapped to a byte over twice the clipmap's influence
 * range; four voxels along x share a word. The program that reads it binds the buffer as
 * `gdfPageAtlas` (`array<u32>`, read only) and calls `gdfAtlasSample`, which answers what a trilinear
 * filter would over the page's voxels: a position within a page — 0 to 7 voxels along each axis,
 * the page's own voxels, the eighth being the filter's margin —, the eight voxels around it
 * weighted by its distance to them. A byte read as a unit value is its number over 255.
 */
export const ATLAS_FETCH_WGSL = wgslBlock(
  'ATLAS_FETCH_WGSL',
  [unorm8],
  `
fn gdfAtlasVoxel(page:u32,voxel:vec3u)->f32{
 let at=page*${IN_ATLAS ** 3}u+(voxel.z*${IN_ATLAS}u+voxel.y)*${IN_ATLAS}u+voxel.x;
 return unorm8(gdfPageAtlas[at>>2u],at&3u);
}
fn gdfAtlasSample(page:u32,local:vec3f)->f32{
 let base=min(vec3u(floor(local)),vec3u(${PAGE - 1}u));
 let f=local-vec3f(base);
 let x0=mix(gdfAtlasVoxel(page,base),gdfAtlasVoxel(page,base+vec3u(1u,0u,0u)),f.x);
 let x1=mix(gdfAtlasVoxel(page,base+vec3u(0u,1u,0u)),gdfAtlasVoxel(page,base+vec3u(1u,1u,0u)),f.x);
 let x2=mix(gdfAtlasVoxel(page,base+vec3u(0u,0u,1u)),gdfAtlasVoxel(page,base+vec3u(1u,0u,1u)),f.x);
 let x3=mix(gdfAtlasVoxel(page,base+vec3u(0u,1u,1u)),gdfAtlasVoxel(page,base+vec3u(1u,1u,1u)),f.x);
 return mix(mix(x0,x1,f.y),mix(x2,x3,f.y),f.z);
}`,
)
