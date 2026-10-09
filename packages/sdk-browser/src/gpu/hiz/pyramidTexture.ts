import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HIZ_MAX_LEVELS } from './uniforms.ts'

/**
 * WHERE THE PYRAMID LIES: one `r32uint` texture of three layers, each the packed mips of
 * `pyramidBytes` laid row after row — the texel of packed index `i` at `(i mod HIZ_ROW, i / HIZ_ROW)`
 * (`hizTexel`). Two layers hold the farthest depth of a cell, of two different depths:
 *  - `HIZ_CULL_FARTHEST`, the farthest of the OCCLUDERS' depth, built mid-frame, before the rest
 *    of the scene is drawn: what the culling (the partition's, the transparent clusters', the
 *    occlusion test) trusts, because the depth only comes nearer after it. Its level 0 is a copy
 *    of level 0.
 *  - `HIZ_WHOLE_FARTHEST`, the farthest of the FINISHED depth, built once every opaque pixel is
 *    drawn: what a ray march of the whole depth needs to know a cell is entirely in front of the
 *    ray (the occluder-only bound is farther, hence too loose to say it). Written at levels 1 and
 *    up only: level 0 is the depth texture itself.
 *  - `HIZ_NEAREST` holds, at the same indices, the nearest of the planes each cell covers, its
 *    level 0 each pixel's plane slopes (`shader.ts`).
 * A word holds a depth's `f32` bits, or two half slopes: a texture, so that a fragment stage reads
 * it as a compute stage does, and integer, so that no bit pattern is a float the hardware may
 * rewrite.
 */
export const HIZ_FORMAT: GPUTextureFormat = 'r32uint'
/** Texels of one row of the pyramid texture, a power of two: the index splits by mask and shift. */
const HIZ_ROW_SHIFT = 13
export const HIZ_ROW = 1 << HIZ_ROW_SHIFT
/** The layers of the pyramid texture, and their count. */
export const HIZ_CULL_FARTHEST = 0
export const HIZ_NEAREST = 1
export const HIZ_WHOLE_FARTHEST = 2
export const HIZ_LAYERS = 3

/** The texture that holds `texels` packed texels a layer: whole rows of `HIZ_ROW`, or one shorter
 *  row when they fit in it. */
export function hizTextureSize(texels: number) {
  const count = Math.max(1, texels)
  return {
    width: Math.min(HIZ_ROW, count),
    height: ceilDiv(count, HIZ_ROW),
    depthOrArrayLayers: HIZ_LAYERS,
  }
}

/** Bytes of the pyramid texture over `texels` packed texels a layer. */
export const hizTextureBytes = (texels: number) => {
  const { width, height } = hizTextureSize(texels)
  return width * height * HIZ_LAYERS * 4
}

/** The texel of packed index `i`. */
export const HIZ_TEXEL_WGSL = wgslBlock(
  'HIZ_TEXEL_WGSL',
  [],
  `fn hizTexel(i:u32)->vec2u{return vec2u(i&${HIZ_ROW - 1}u,i>>${HIZ_ROW_SHIFT}u);}`,
)

/** The three layers at packed index `i` of the sampled pyramid `hizPyramid` the host declares
 *  (`texture_2d_array<u32>`): the culling's farthest depth, the nearest, and the finished depth's
 *  farthest. */
export const HIZ_READ_WGSL = wgslBlock(
  'HIZ_READ_WGSL',
  [HIZ_TEXEL_WGSL],
  `fn hizCullFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),${HIZ_CULL_FARTHEST},0).r);}
fn hizNearest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),${HIZ_NEAREST},0).r);}
fn hizWholeFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),${HIZ_WHOLE_FARTHEST},0).r);}`,
)

/** Words of the levels uniform (`HizLevels`): per level its first packed index, its width and
 *  height, and the count of levels. */
export const HIZ_LEVELS_WORDS = HIZ_MAX_LEVELS * 4

/** The levels uniform of a pyramid of `sizes` at `offsets` (`pyramidBytes`), its first
 *  `HIZ_MAX_LEVELS` built. */
export function hizLevelWords(sizes: Array<[number, number]>, offsets: number[]) {
  const words = new Uint32Array(HIZ_LEVELS_WORDS)
  const count = Math.min(sizes.length, HIZ_MAX_LEVELS)
  for (let level = 0; level < count; level++)
    words.set([offsets[level], ...sizes[level], count], level * 4)
  return words
}

/** The layout entries of a depth reader (`hizDepthWgsl`) from `binding`, read by `visibility`. */
export const hizDepthEntries = (binding: number, visibility: number): GPUBindGroupLayoutEntry[] => [
  { binding, visibility, texture: { sampleType: 'unfilterable-float' } },
  { binding: binding + 1, visibility, texture: { sampleType: 'uint', viewDimension: '2d-array' } },
  { binding: binding + 2, visibility, buffer: { type: 'uniform' } },
]

/**
 * What a reader of the whole depth binds in group `group` from `binding` (`GpuHiz.depth`): level 0,
 * the depth the image drew, the pyramid, and its levels. `hizPlane` is a pixel's depth and its
 * plane's slopes in depth per pixel; `hizCell` a cell of a level from 1 up, its farthest depth of
 * the finished image and its nearest. Both clamp the cell to the level: the last texel of a level covers the image's edge.
 */
export const hizDepthWgsl = (group: number, binding: number) =>
  wgslBlock(
    `hizDepthWgsl(${group}, ${binding})`,
    [HIZ_READ_WGSL],
    `struct HizLevels{level:array<vec4u,${HIZ_MAX_LEVELS}>,}
@group(${group}) @binding(${binding}) var hizDepth:texture_2d<f32>;
@group(${group}) @binding(${binding + 1}) var hizPyramid:texture_2d_array<u32>;
@group(${group}) @binding(${binding + 2}) var<uniform> hizLevels:HizLevels;
fn hizLevelCount()->i32{return i32(hizLevels.level[0].w);}
fn hizPlane(cell:vec2i)->vec3f{
 let size=hizLevels.level[0].yz;
 let p=vec2u(clamp(cell,vec2i(0),vec2i(size)-vec2i(1)));
 let z=textureLoad(hizDepth,p,0).r;
 let slopes=unpack2x16float(textureLoad(hizPyramid,hizTexel(p.y*size.x+p.x),${HIZ_NEAREST},0).r);
 return vec3f(z,slopes*z);
}
fn hizCell(cell:vec2i,level:i32)->vec2f{
 let at=hizLevels.level[level];
 let p=vec2u(clamp(cell,vec2i(0),vec2i(at.yz)-vec2i(1)));
 let i=at.x+p.y*at.y+p.x;
 return vec2f(hizWholeFarthest(i),hizNearest(i));
}`,
  )
