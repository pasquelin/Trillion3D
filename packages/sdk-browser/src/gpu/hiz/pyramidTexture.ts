import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HIZ_MAX_LEVELS } from './uniforms.ts'

/**
 * WHERE THE PYRAMID LIES: one `r32uint` texture of three layers, each `max(N, 3M)` words laid row
 * after row — the word of linear index `j` at `(j mod HIZ_ROW, j / HIZ_ROW)` (`hizTexel`) —, for a
 * pyramid whose level 0 holds `N` texels and its coarser levels `M` in all (`pyramidBytes`: `M` is a
 * third of `N`). Three bounds of a cell are kept, of three different depths:
 *  - `HIZ_CULL_FARTHEST`, the farthest of the OCCLUDERS' depth, built mid-frame, before the rest
 *    of the scene is drawn: what the culling (the partition's, the transparent clusters', the
 *    occlusion test) trusts, because the depth only comes nearer after it. Its level 0 is a copy
 *    of level 0.
 *  - `HIZ_WHOLE_FARTHEST`, the farthest of the FINISHED depth, built once every opaque pixel is
 *    drawn: what a ray march of the whole depth needs to know a cell is entirely in front of the
 *    ray (the occluder-only bound is farther, hence too loose to say it). It has no level 0: that
 *    is the depth texture itself.
 *  - `HIZ_NEAREST` holds the nearest of the planes each cell covers, its level 0 each pixel's plane
 *    slopes (`shader.ts`).
 * The layers of level 0 are the texture's first two, `N` words each; the coarser levels of all
 * three bounds lie in its third, one after the other (`hizRoute`): `3M` words, so that no word of
 * the texture goes unused, where three whole pyramids would keep `N` of them for a level 0 nobody
 * reads — `4N` words against `3N`, a quarter of the pyramid. A word holds a depth's `f32` bits, or
 * two half slopes: a texture, so that a fragment stage reads it as a compute stage does, and
 * integer, so that no bit pattern is a float the hardware may rewrite.
 */
export const HIZ_FORMAT: GPUTextureFormat = 'r32uint'
/** Texels of one row of the pyramid texture, a power of two: the index splits by mask and shift. */
const HIZ_ROW_SHIFT = 13
const HIZ_ROW = 1 << HIZ_ROW_SHIFT
/** The layers of the pyramid texture, and their count. */
export const HIZ_CULL_FARTHEST = 0
export const HIZ_NEAREST = 1
export const HIZ_WHOLE_FARTHEST = 2
const HIZ_LAYERS = 3
/** The flag of an index into the coarser levels, which lie in the last layer (`hizRoute`); the
 *  bits under it are the word's linear index. */
const HIZ_UPPER = 2 ** 28

/** The words a layer of the pyramid texture holds for a pyramid of `first` texels at level 0 and
 *  `upper` in its coarser levels: the first layers hold level 0, the last the coarser levels of the
 *  three bounds. */
const hizLayerWords = ({ first, upper }: { first: number; upper: number }) =>
  Math.max(1, first, HIZ_LAYERS * upper)

/**
 * The index of the cell at natural packed index `offset` (`pyramidBytes`, level 0 first) in the
 * layer `layer`'s bound: level 0 keeps its own index, in its own layer; a coarser level lies in the
 * last layer, after the `layer` bounds before it, flagged `HIZ_UPPER`.
 */
export const hizRoute = (
  offset: number,
  level: number,
  layer: number,
  { first, upper }: { first: number; upper: number },
) => (level === 0 ? offset : HIZ_UPPER + offset - first + layer * upper)

/** The texture that holds a pyramid of `layout` (`pyramidBytes`): whole rows of `HIZ_ROW`, or one
 *  shorter row when they fit in it. */
export function hizTextureSize(layout: { first: number; upper: number }) {
  const count = hizLayerWords(layout)
  return {
    width: Math.min(HIZ_ROW, count),
    height: ceilDiv(count, HIZ_ROW),
    depthOrArrayLayers: HIZ_LAYERS,
  }
}

/** Bytes of the pyramid texture over a pyramid of `layout`. */
export const hizTextureBytes = (layout: { first: number; upper: number }) => {
  const { width, height } = hizTextureSize(layout)
  return width * height * HIZ_LAYERS * 4
}

/** The texel of index `i` (`hizRoute`), and its layer: `layer` for a level 0, the last for a coarser
 *  level. */
export const HIZ_TEXEL_WGSL = wgslBlock(
  'HIZ_TEXEL_WGSL',
  [],
  `const HIZ_UPPER:u32=${HIZ_UPPER}u;
fn hizTexel(i:u32)->vec2u{let j=i&(HIZ_UPPER-1u);return vec2u(j&${HIZ_ROW - 1}u,j>>${HIZ_ROW_SHIFT}u);}
fn hizSlice(i:u32,layer:u32)->u32{return select(layer,${HIZ_LAYERS - 1}u,(i&HIZ_UPPER)!=0u);}`,
)

/** The three bounds at index `i` of the sampled pyramid `hizPyramid` the host declares
 *  (`texture_2d_array<u32>`), each in its own routing (`hizRoute`): the culling's farthest depth,
 *  the nearest, and the finished depth's farthest. */
export const HIZ_READ_WGSL = wgslBlock(
  'HIZ_READ_WGSL',
  [HIZ_TEXEL_WGSL],
  `fn hizCullFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i,${HIZ_CULL_FARTHEST}u),0).r);}
fn hizNearest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i,${HIZ_NEAREST}u),0).r);}
fn hizWholeFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i,${HIZ_WHOLE_FARTHEST}u),0).r);}`,
)

/** Words of the levels uniform (`HizLevels`): per level the first index of its nearest bound, its
 *  width and height, and the first index of its finished depth's farthest bound (`hizRoute`);
 *  then the count of levels. */
export const HIZ_LEVELS_WORDS = HIZ_MAX_LEVELS * 4 + 4

/** The levels uniform of a pyramid of `sizes` at `offsets` (`pyramidBytes`), its first
 *  `HIZ_MAX_LEVELS` built. */
export function hizLevelWords(
  sizes: Array<[number, number]>,
  offsets: number[],
  layout: { first: number; upper: number },
) {
  const words = new Uint32Array(HIZ_LEVELS_WORDS)
  const count = Math.min(sizes.length, HIZ_MAX_LEVELS)
  for (let level = 0; level < count; level++)
    words.set(
      [
        hizRoute(offsets[level], level, HIZ_NEAREST, layout),
        ...sizes[level],
        hizRoute(offsets[level], level, HIZ_WHOLE_FARTHEST, layout),
      ],
      level * 4,
    )
  words[HIZ_MAX_LEVELS * 4] = count
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
 * plane's slopes in depth per pixel; `hizCellFarthest` and `hizCellNearest` a cell of a level from 1 up, its
 * farthest depth of the finished image and its nearest, each its own read. Both clamp the cell to the level: the last texel of a level covers the image's edge.
 */
export const hizDepthWgsl = (group: number, binding: number) =>
  wgslBlock(
    `hizDepthWgsl(${group}, ${binding})`,
    [HIZ_READ_WGSL],
    `struct HizLevels{level:array<vec4u,${HIZ_MAX_LEVELS}>,count:vec4u,}
@group(${group}) @binding(${binding}) var hizDepth:texture_2d<f32>;
@group(${group}) @binding(${binding + 1}) var hizPyramid:texture_2d_array<u32>;
@group(${group}) @binding(${binding + 2}) var<uniform> hizLevels:HizLevels;
fn hizLevelCount()->i32{return i32(hizLevels.count.x);}
fn hizPlane(cell:vec2i)->vec3f{
 let size=hizLevels.level[0].yz;
 let p=vec2u(clamp(cell,vec2i(0),vec2i(size)-vec2i(1)));
 let z=textureLoad(hizDepth,p,0).r;
 let slopes=unpack2x16float(textureLoad(hizPyramid,hizTexel(p.y*size.x+p.x),${HIZ_NEAREST},0).r);
 return vec3f(z,slopes*z);
}
fn hizCellStep(cell:vec2i,level:i32)->u32{
 let size=hizLevels.level[level].yz;
 let p=vec2u(clamp(cell,vec2i(0),vec2i(size)-vec2i(1)));
 return p.y*size.x+p.x;
}
fn hizCellNearest(cell:vec2i,level:i32)->f32{return hizNearest(hizLevels.level[level].x+hizCellStep(cell,level));}
fn hizCellFarthest(cell:vec2i,level:i32)->f32{return hizWholeFarthest(hizLevels.level[level].w+hizCellStep(cell,level));}`,
  )
