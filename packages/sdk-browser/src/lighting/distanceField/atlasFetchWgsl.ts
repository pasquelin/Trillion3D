import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unorm8 } from '../../../../math/src/wgsl/color.ts'
import {
  GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION as COVERAGE,
  GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS as COVERAGE_IN_ATLAS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION as PAGE,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS as IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S ATLASES, READ. The page atlas holds, for each page, 8 × 8 × 8 voxels —
 * the page's own 7 along each axis, the eighth the trilinear filter's margin — each the distance to
 * the nearest surface mapped to a byte over twice the clipmap's influence range. A page's place in
 * the atlas is its index split into its x (7 bits), its y (7 bits) and its layer: the atlas is 128
 * pages wide and as wide again, a layer of pages each of 8 voxels deep.
 *
 * Where the device allows the 8-bit format as a storage texture (`../../gpu/core/textureFormatsTier.ts`)
 * the atlas is a 3D texture (`gdfAtlasTexture`, `r8unorm`) read through a sampler
 * (`gdfAtlasSampler`, linear, repeating) — `gdfAtlasSampleTexture`: the position within a page, 0 to 7
 * voxels along each axis, carried to the atlas's coordinate and filtered by the hardware. Else the
 * atlas is a buffer of bytes (`gdfPageAtlas`, `array<u32>`, read only), a page after the other, four
 * voxels along x to a word — `gdfAtlasSampleBuffer`: the eight voxels around the position weighted
 * by its distance to them, what the hardware would give. A byte read as a unit value is its number
 * over 255. A program binds one of them and calls its own; a reader that must serve both
 * (`globalReadWgsl.ts`) binds both and chooses by the view block's flag.
 *
 * The coverage atlas lives in the same buffer, past the pages' bytes (`gdfView.coverageBase`, the word it begins at; 0
 * where the pages are a texture and the buffer holds it alone): 4 × 4 × 4 bytes a page, the voxels at every second
 * texel of the page along each axis, 1 for a voxel reached by a one-sided mesh or by none, 0 for one only
 * two-sided meshes reach (`coverageWgsl.ts`); four voxels along x share a word, a page is 16 words. It is read
 * with the same trilinear weights by hand (`gdfCoverageSample`): a position in a page, in the page's own 7
 * voxels, is carried to the lattice's 3 (`COVERAGE_PAGE_RESOLUTION`). A texture of it would be a seventeenth
 * sampled texture of the reflections' scene stage, past the 16 WebGPU guarantees, and a buffer of its own one
 * more of the 8 storage buffers.
 */

/** A page's place in the atlas, in pages: its index split as the atlas lays them out. */
export const ATLAS_OFFSET_WGSL = wgslBlock(
  'ATLAS_OFFSET_WGSL',
  [],
  `
fn gdfAtlasOffset(index:u32)->vec3u{return vec3u(index&0x7Fu,(index>>7u)&0x7Fu,index>>14u);}`,
)

/** The page atlas as a buffer of bytes, sampled by hand: needs `gdfPageAtlas` bound. */
export const ATLAS_BUFFER_WGSL = wgslBlock(
  'ATLAS_BUFFER_WGSL',
  [unorm8],
  `
fn gdfAtlasVoxel(page:u32,voxel:vec3u)->f32{
 let at=page*${IN_ATLAS ** 3}u+(voxel.z*${IN_ATLAS}u+voxel.y)*${IN_ATLAS}u+voxel.x;
 return unorm8(gdfPageAtlas[at>>2u],at&3u);
}
fn gdfAtlasSampleBuffer(page:u32,local:vec3f)->f32{
 let base=min(vec3u(floor(local)),vec3u(${PAGE - 1}u));
 let f=local-vec3f(base);
 let x0=mix(gdfAtlasVoxel(page,base),gdfAtlasVoxel(page,base+vec3u(1u,0u,0u)),f.x);
 let x1=mix(gdfAtlasVoxel(page,base+vec3u(0u,1u,0u)),gdfAtlasVoxel(page,base+vec3u(1u,1u,0u)),f.x);
 let x2=mix(gdfAtlasVoxel(page,base+vec3u(0u,0u,1u)),gdfAtlasVoxel(page,base+vec3u(1u,0u,1u)),f.x);
 let x3=mix(gdfAtlasVoxel(page,base+vec3u(0u,1u,1u)),gdfAtlasVoxel(page,base+vec3u(1u,1u,1u)),f.x);
 return mix(mix(x0,x1,f.y),mix(x2,x3,f.y),f.z);
}`,
)

/** The page atlas as a texture, sampled by the hardware: needs `gdfAtlasTexture` and `gdfAtlasSampler` bound. */
export const ATLAS_TEXTURE_WGSL = wgslBlock(
  'ATLAS_TEXTURE_WGSL',
  [ATLAS_OFFSET_WGSL],
  `
fn gdfAtlasSampleTexture(page:u32,local:vec3f)->f32{
 let at=vec3f(gdfAtlasOffset(page)*${IN_ATLAS}u)+local+0.5;
 return textureSampleLevel(gdfAtlasTexture,gdfAtlasSampler,at/vec3f(textureDimensions(gdfAtlasTexture)),0.0).x;
}`,
)

/** The coverage atlas, sampled by hand: needs `gdfPageAtlas` bound and `gdfView.coverageBase`. */
export const COVERAGE_FETCH_WGSL = wgslBlock(
  'COVERAGE_FETCH_WGSL',
  [unorm8],
  `
fn gdfCoverageVoxel(page:u32,voxel:vec3u)->f32{
 return unorm8(gdfPageAtlas[gdfView.coverageBase+(page*${COVERAGE_IN_ATLAS}u+voxel.z)*${COVERAGE_IN_ATLAS}u+voxel.y],voxel.x);
}
fn gdfCoverageSample(page:u32,local:vec3f)->f32{
 let at=local*${COVERAGE / PAGE};
 let base=min(vec3u(floor(at)),vec3u(${COVERAGE - 1}u));
 let f=at-vec3f(base);
 let x0=mix(gdfCoverageVoxel(page,base),gdfCoverageVoxel(page,base+vec3u(1u,0u,0u)),f.x);
 let x1=mix(gdfCoverageVoxel(page,base+vec3u(0u,1u,0u)),gdfCoverageVoxel(page,base+vec3u(1u,1u,0u)),f.x);
 let x2=mix(gdfCoverageVoxel(page,base+vec3u(0u,0u,1u)),gdfCoverageVoxel(page,base+vec3u(1u,0u,1u)),f.x);
 let x3=mix(gdfCoverageVoxel(page,base+vec3u(0u,1u,1u)),gdfCoverageVoxel(page,base+vec3u(1u,1u,1u)),f.x);
 return mix(mix(x0,x1,f.y),mix(x2,x3,f.y),f.z);
}`,
)
