import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../../gpu/core/computeBindings.ts'
import { HIZ_MAX_LEVELS } from './uniforms.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { texelBytesOf } from '../../../gpu/core/textureBytes.ts'
import type { HizDepth } from './types.ts'

/**
 * WHERE THE PYRAMID LIES: one `r32uint` texture of two slices, each `max(N, 3M)` words laid row
 * after row — the word of linear index `j` at `(j mod HIZ_ROW, j / HIZ_ROW)` (`hizTexel`) —, for a
 * pyramid whose level 0 holds `N` texels and its coarser levels `M` in all (`pyramidBytes`: `M` is a
 * third of `N`). Three bounds of a cell are kept, of three different depths:
 *  - `HIZ_CULL_FARTHEST`, the farthest of the OCCLUDERS' depth, built mid-frame, before the rest
 *    of the scene is drawn: what the culling (the transparent clusters', the cut's occlusion)
 *    trusts, because the depth only comes nearer after it. It starts at level 1, reduced from the
 *    depth texture: the pyramid has no copy of the depth.
 *  - `HIZ_WHOLE_FARTHEST`, the farthest of the FINISHED depth, built once every opaque pixel is
 *    drawn: what a ray march of the whole depth needs to know a cell is entirely in front of the
 *    ray (the occluder-only bound is farther, hence too loose to say it). It has no level 0: that
 *    is the depth texture itself.
 *  - `HIZ_NEAREST` holds the nearest of the planes each cell covers, its level 0 each pixel's plane
 *    slopes (`shader.ts`), written only while the planes are kept.
 * The only level 0 the texture holds is the nearest layer's slopes, in its first slice, `N` words;
 * the coarser levels of all three bounds lie in its second, one after the other (`hizRoute`): `3M`
 * words. A word holds a depth's `f32` bits, or
 * two half slopes: a texture, so that a fragment stage reads it as a compute stage does, and
 * integer, so that no bit pattern is a float the hardware may rewrite.
 */
export const HIZ_FORMAT: GPUTextureFormat = 'r32uint'

/** Texels of one row of the pyramid texture, a power of two: the index splits by mask and shift. */
const HIZ_ROW_SHIFT = 13
const HIZ_ROW = 1 << HIZ_ROW_SHIFT
/** The bounds the pyramid keeps, and the slices of the texture (`hizSlice`): level 0, then the coarser levels. */
export const HIZ_CULL_FARTHEST = 0
export const HIZ_NEAREST = 1
export const HIZ_WHOLE_FARTHEST = 2
const HIZ_BOUNDS = 3
const HIZ_SLICES = 2
/** The flag of an index into the coarser levels, which lie in the last slice (`hizRoute`); the
 *  bits under it are the word's linear index. */
const HIZ_UPPER = 2 ** 28

/** The words a slice of the pyramid texture holds for a pyramid of `first` texels at level 0 and
 *  `upper` in its coarser levels: the first slice holds level 0, the last the coarser levels of the
 *  three bounds. */
const hizLayerWords = ({ first, upper }: { first: number; upper: number }) =>
  Math.max(1, first, HIZ_BOUNDS * upper)

/**
 * The index of the cell at natural packed index `offset` (`pyramidBytes`, level 0 first) in the
 * layer `layer`'s bound: level 0 keeps its own index, in the first slice; a coarser level lies in the
 * last slice, after the `layer` bounds before it, flagged `HIZ_UPPER`.
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
    depthOrArrayLayers: HIZ_SLICES,
  }
}

/** Bytes of the pyramid texture over a pyramid of `layout`. */
export const hizTextureBytes = (layout: { first: number; upper: number }) => {
  const { width, height } = hizTextureSize(layout)
  return width * height * HIZ_SLICES * texelBytesOf(HIZ_FORMAT)
}

/** The texel of index `i` (`hizRoute`), and its slice: the first for a level 0, the last for a coarser
 *  level. */
export const HIZ_TEXEL_WGSL = wgslBlock(
  'HIZ_TEXEL_WGSL',
  [],
  `const HIZ_UPPER:u32=${HIZ_UPPER}u;
fn hizTexel(i:u32)->vec2u{let j=i&(HIZ_UPPER-1u);return vec2u(j&${HIZ_ROW - 1}u,j>>${HIZ_ROW_SHIFT}u);}
fn hizSlice(i:u32)->u32{return select(0u,${HIZ_SLICES - 1}u,(i&HIZ_UPPER)!=0u);}`,
)

/** The three bounds at index `i` of the sampled pyramid `hizPyramid` the host declares
 *  (`texture_2d_array<u32>`), each in its own routing (`hizRoute`): the culling's farthest depth,
 *  the nearest, and the finished depth's farthest. */
export const HIZ_READ_WGSL = wgslBlock(
  'HIZ_READ_WGSL',
  [HIZ_TEXEL_WGSL],
  `fn hizCullFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i),0).r);}
fn hizNearest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i),0).r);}
fn hizWholeFarthest(i:u32)->f32{return bitcast<f32>(textureLoad(hizPyramid,hizTexel(i),hizSlice(i),0).r);}`,
)

/** The layout entries of a depth reader (`hizDepthWgsl`) from `binding`, read by `visibility`. */
export const hizDepthEntries = (binding: number, visibility: number): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(binding, 'unfilterable-float', '2d-array', visibility),
  computeTextureEntry(binding + 1, 'uint', '2d-array', visibility),
  computeUniformEntry(binding + 2, {}, visibility),
]

/** The bind-group entries of `depth` (`GpuHiz.depth`) from `binding`, the resources of
 *  `hizDepthEntries` in their order: the one place they are written. */
export const hizDepthBindEntries = (binding: number, depth: HizDepth): GPUBindGroupEntry[] =>
  sequentialEntries(depth.resources, binding)

/** The layout entries of a reader that loads level 0 alone (`hizOpaqueDepth`, `hizFrontDepth`): the depth
 *  texture and the levels uniform, at the bindings `hizDepthEntries` gives them, not the pyramid (`hizDepthWgsl`
 *  declares the three, a program's layout holds those its entry points use). */
export const hizLevelZeroEntries = (binding: number, visibility: number) => {
  const [depth, , levels] = hizDepthEntries(binding, visibility)
  return [depth, levels]
}

/** The bind-group entries of `hizLevelZeroEntries`. */
export const hizLevelZeroBindEntries = (binding: number, depth: HizDepth) => {
  const [level, , levels] = hizDepthBindEntries(binding, depth)
  return [level, levels]
}

/** The layers of the level-0 texture: the opaque depth and — only for a scene whose transparents
 *  ever drew a front pass (blends, water, transmission) — the nearest
 *  transparent surface's (`lighting/reflections/frontLayer.ts`, a depth a pixel, zero for none), made at the
 *  first ask and kept (`GpuHiz.front`). An opaque scene's level 0 is one layer: it pays no byte for
 *  transparents. */
export const HIZ_OPAQUE_LAYER = 0
export const HIZ_FRONT_LAYER = 1
/** The layers of a level 0 that holds the front depth. */
export const HIZ_DEPTH_LAYERS = 2

/**
 * The front-over-opaque fold, written once for every reader (`hizDepthWgsl`, the Hi-Z build): at
 * pixel `p` of the level-0 texture `depth`, the opaque depth and, where this image wrote the front
 * layer (`front`, a frame word: `HIZ_LEVELS_FRONT_WORD`, `HIZ_UNI.at.front`), the nearest
 * transparent surface's, reverse-Z, so the larger. An image that did not write it, or a pixel
 * without a transparent surface, reads the opaque depth, bit for bit: a layer kept from the last
 * glass is never folded, and an opaque image loads one texel.
 */
export const HIZ_FOLD_WGSL = wgslBlock(
  'HIZ_FOLD_WGSL',
  [],
  `fn hizFold(depth:texture_2d_array<f32>,p:vec2i,front:bool)->f32{
 let opaque=textureLoad(depth,p,${HIZ_OPAQUE_LAYER},0).r;
 if(!front){return opaque;}
 return max(opaque,textureLoad(depth,p,${HIZ_FRONT_LAYER},0).r);
}
fn hizFoldOver(depth:texture_2d_array<f32>,p:vec2i,front:bool)->bool{
 if(!front){return false;}
 return textureLoad(depth,p,${HIZ_FRONT_LAYER},0).r>textureLoad(depth,p,${HIZ_OPAQUE_LAYER},0).r;
}`,
)

/** The levels uniform's struct (`hizLevelWords`), declared by every host that binds it as
 *  \`hizLevels\`: per level its nearest bound's first index, width, height and finished depth's
 *  farthest's first index; then the count of levels, the front word, \`upper\` (\`hizRoute\`) and the
 *  planes word (\`hizTracePlanes\`). */
export const HIZ_LEVELS = fieldLayout('HizLevels', [
  ['level', { wgsl: `array<vec4u,${HIZ_MAX_LEVELS}>`, words: 4 * HIZ_MAX_LEVELS, align: 4 }],
  ['count', 'vec4u'],
])
/** `HIZ_LEVELS`'s declaration, which the hosts list. */
export const HIZ_LEVELS_STRUCT_WGSL = wgslBlock('HIZ_LEVELS_STRUCT_WGSL', [], HIZ_LEVELS.wgsl)

/**
 * What a reader of the whole depth binds in group `group` from `binding` (`GpuHiz.depth`): level 0 —
 * the depth the image drew, and in its second layer, when it holds one, the nearest transparent
 * surface's depth a pixel (zero for none) —, the pyramid and its levels. `hizOpaqueDepth` is a
 * pixel's opaque depth alone, the transparent layer left out; `hizPlane` is a pixel's depth (the
 * nearer of the opaque depth and the transparent one where the setting `hizFoldTransparents`
 * folds it in, as the nearest layer's bounds do, `hizFold`) and its plane's slopes in depth per
 * pixel — the planes of `hizTrace` `'planes'`; `hizTracePlanes` says the pyramid was built so —, and `hizFrontOver` whether that depth is a transparent
 * surface's (`hizFoldOver`), in front of the opaque one (a reader that takes only opaque surfaces for walls skips
 * it); `hizCellFarthest` and `hizCellNearest` a cell of a level from 1 up, its farthest depth of the
 * finished image and its nearest, each its own read, in the pyramid built for `hizTrace` `'planes'`
 * (`hizTracePlanes`); `hizCellCullFarthest` a cell's farthest depth of the opaque image alone, the
 * culling layer's — the farthest of the reference's pyramid, built in every mode. All clamp the cell
 * to the level: the last texel of a level covers the image's edge.
 */
export const hizDepthWgsl = (group: number, binding: number) =>
  wgslBlock(
    `hizDepthWgsl(${group}, ${binding})`,
    [HIZ_READ_WGSL, HIZ_FOLD_WGSL, HIZ_LEVELS_STRUCT_WGSL],
    `@group(${group}) @binding(${binding}) var hizDepth:texture_2d_array<f32>;
@group(${group}) @binding(${binding + 1}) var hizPyramid:texture_2d_array<u32>;
@group(${group}) @binding(${binding + 2}) var<uniform> hizLevels:HizLevels;
fn hizLevelCount()->i32{return i32(hizLevels.count.x);}
fn hizTracePlanes()->bool{return hizLevels.count.w!=0u;}
fn hizPixelIn(cell:vec2i,size:vec2u)->vec2u{return vec2u(clamp(cell,vec2i(0),vec2i(size)-vec2i(1)));}
fn hizPixel(cell:vec2i)->vec2u{return hizPixelIn(cell,hizLevels.level[0].yz);}
fn hizOpaqueDepth(cell:vec2i)->f32{return textureLoad(hizDepth,vec2i(hizPixel(cell)),${HIZ_OPAQUE_LAYER},0).r;}
fn hizFrontDepth(cell:vec2i)->f32{return hizFold(hizDepth,vec2i(hizPixel(cell)),hizLevels.count.y!=0u);}
fn hizFrontOver(cell:vec2i)->bool{return hizFoldOver(hizDepth,vec2i(hizPixel(cell)),hizLevels.count.y!=0u);}
fn hizPlane(cell:vec2i)->vec3f{
 let size=hizLevels.level[0].yz;
 let p=hizPixel(cell);
 let z=hizFrontDepth(cell);
 let slopes=unpack2x16float(textureLoad(hizPyramid,hizTexel(p.y*size.x+p.x),0,0).r);
 return vec3f(z,slopes*z);
}
fn hizCellStep(cell:vec2i,level:i32)->u32{
 let size=hizLevels.level[level].yz;
 let p=hizPixelIn(cell,size);
 return p.y*size.x+p.x;
}
fn hizCellNearest(cell:vec2i,level:i32)->f32{return hizNearest(hizLevels.level[level].x+hizCellStep(cell,level));}
fn hizCellFarthest(cell:vec2i,level:i32)->f32{return hizWholeFarthest(hizLevels.level[level].w+hizCellStep(cell,level));}
fn hizCellCullFarthest(cell:vec2i,level:i32)->f32{return hizCullFarthest(hizLevels.level[level].x-hizLevels.count.z+hizCellStep(cell,level));}`,
  )
