import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { WRAP_COORD_WGSL } from '../../visibility/wrapModes.ts'
import { VIS_BINDINGS, type AtlasBindings } from '../../gpu/bind/bindLayout.ts'
import { MAX_LEVELS } from '../texture/tiles.ts'
import { TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS, PAGE_TRANSFORM_WORD } from './page/pageTable.ts'
import { SAMPLING_WGSL } from './sampling/samplingWgsl.ts'
import { POOL_PLACE_WGSL } from './pool/poolPlaceWgsl.ts'
import { atlasReadWgsl, type Footprint } from './atlas/atlasReadWgsl.ts'
import {
  TILE_SLOT_WGSL,
  atlasLodWgsl,
  samplingFootprintWgsl,
} from '../texture/samplingFootprint.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { highHalf, lowHalf, mipSize2 } from '../../../../math/src/wgsl/integer.ts'
import { unitToSigned2 } from '../../../../math/src/wgsl/reals.ts'

/**
 * Virtual-texture reads shared by every pass: an indirection through the page table, then a sample
 * from the pool. LOD is chosen the way the GPU would — the log of the larger of the two gradients —
 * and filtering between two levels is done here, by mixing, because the pool has no mip chain: each
 * level of a texture lives in its own tiles.
 *
 * A missing tile is never invented: the table points at the finest resident ancestor, the tail as
 * last resort, and the read is the same as with the tile — at a coarser level. That is the pool's
 * declared loss, never a fill texel. The shadow pass alone reads `finest`: a tile missing at its
 * level reads the finest resident tile under that texel — the one the camera brought in — never the
 * tail while one is available, so the shadow of a leaf nobody requested at that level stays a leaf
 * and not a 64-texel blotch.
 *
 * A texture's header — size, tail, last level, tail placement — is read ONCE per sample (`TileSlot`,
 * `TILE_SLOT_WGSL`),
 * not once per tap: each of the two taps of a mix only adds its level address and its entry. On a
 * foliage pixel that is the difference between a chain of twelve dependent reads and a chain of six.
 * Two variants measured and discarded at 2496×1404 (materials pass 5.64 ms): the table
 * bound as `vec4<u32>`, the header packed in one word — 5.70 ms, no effect; the level address
 * recomputed in a loop instead of being read — 6.5 ms, the divergent arithmetic costs more than the
 * read it avoids.
 *
 * A texture's sampling — addressing, filters, anisotropy, UV transform — rides in the same header
 * (`texture/sampling.ts`): its filter word and addressing nibble share the last-level word, so a read
 * fetches no more words than before. Whether the filter rule runs is the page's, not the
 * sample's (`sampled`, `atlas/atlasReadWgsl.ts`): a page at the default filters takes the same read, and
 * the resolve does not even compile the other.
 *
 * Coordinates are clamped to the half-texel of the level being read: linear filtering therefore never
 * leaves a level's texels, nor a tail tile toward its neighbour, and the seam of a repeating period
 * is the one `wrapUv` mixes by hand — at each level read, on that level's size (`${k}Level`), as
 * the sampler of a mip chain mixes a level's last texel and its first.
 *
 * An atlas has one pool per LANE — lossless RGBA8, RGBA blocks, two-channel blocks — and a
 * texture's header names the TAP every tile of it takes (`../texture/blockFormats.ts`, `tapOf`):
 * the pool it samples, the same place arithmetic on each, and for a two-channel block which
 * channel holds Y — the second for BC5, the alpha for the ASTC luminance-alpha block. A
 * two-channel read is a normal map's X and Y, Z rebuilt from the two channels as the unit-length
 * remainder —, so what the material receives is the three-channel map it would have read from a
 * lossless lane.
 *
 * The host shader declares one `${k}Pool<lane>` per lane in `PREVIEW_LAYOUT_NAMES` order — `colorPool0`,
 * `colorPool1`, `colorPool2`, the same for `data` —, `mapsSampler`, `colorPages` and `dataPages`,
 * at the bindings `../../gpu/bind/bindEntries.ts` publishes.
 *
 * `mipBias` is the WGSL expression every level choice adds to its LOD (`atlasLodWgsl`), the read's
 * and the request's alike: a frame the temporal pass upscales adds `log2(render / display)` and
 * the −0.3 sharpening offset, so a texture keeps the display's texel density (`../../post/taa/jitter.ts`,
 * `upscaleMipBias`).
 * The pool provides the footprint rule at that level (`samplingFootprintWgsl`). The reads take the
 * pool as a provider (`tileKindWgsl`, `atlasReadWgsl`); its variants share one name, so a program
 * holding two biases is refused when it is written.
 */
const tilePoolWgsl = (mipBias: string) => {
  const lod = atlasLodWgsl(mipBias)
  return wgslBlock(
    'tilePoolWgsl',
    [
      WRAP_COORD_WGSL,
      SAMPLING_WGSL,
      POOL_PLACE_WGSL,
      TILE_SLOT_WGSL,
      unitToSigned2,
      mipSize2,
      lowHalf,
      highHalf,
      lod,
      samplingFootprintWgsl(lod),
    ],
    `const TEXEL_TILE:f32=${wgslF32(TILE_SIZE)};
${wgslConsts({
  PAGE_HEADER: PAGE_HEADER_WORDS,
  PAGE_SLOT: PAGE_SLOT_WORDS,
  PAGE_LEVELS: MAX_LEVELS,
  PAGE_TRANSFORM: PAGE_TRANSFORM_WORD,
})}
/** A normal map's Z from its X and Y, as the map stores them (0..1), for a two-channel lane. */
fn rebuiltZ(xy:vec2f)->f32{let n=unitToSigned2(xy);return (sqrt(max(0.0,1.0-dot(n,n)))+1.0)*0.5;}
/** LOD a footprint asks of a texture, clamped to its levels: the single rule for choosing a level
 *  of a texture at the default filters, for the read as for the request. */
fn slotLod(s:TileSlot,ddx:vec2f,ddy:vec2f)->f32{return clamp(atlasLod(ddx*s.size,ddy*s.size),0.0,f32(s.last));}
/** Coordinate brought back into the texture by its addressing nibble, near side of a seam. */
fn slotWrapped(s:TileSlot,uv:vec2f)->vec2f{
 if(!wrapRepete(s.wrap)){return wrapReplie(uv,s.wrap);}
 return wrapUv(uv,s.wrap,s.size).proche;
}
fn sizeOf(word:u32)->vec2f{return vec2f(f32(lowHalf(word)),f32(highHalf(word)));}
/** Size of a level, \`mipSize2\` as the CPU lays it out (\`../../texture/tiles.ts\`): a texture's
 *  sides are integers under 2^16, exact in f32. */
fn levelSize(size:vec2f,level:u32)->vec2f{return vec2f(mipSize2(vec2u(size),level));}
fn levelTexel(uv:vec2f,lsize:vec2f)->vec2f{return clamp(uv*lsize,vec2f(0.5),lsize-0.5);}
/** Entry of a texel in its level: its tile, in tile rows. */
fn tileEntry(texel:vec2f,lsize:vec2f)->u32{return u32(texel.y/TEXEL_TILE)*u32(ceil(lsize.x/TEXEL_TILE))+u32(texel.x/TEXEL_TILE);}
`,
  )
}
/** The pool of the camera's passes — visibility, compute raster, surfaces, transparents —, whose
 *  uniform `uni` carries the frame's texture level offset. */
export const TILE_POOL_WGSL = tilePoolWgsl('uni.mipBias')
/** The pool read at no level offset: the shadow passes'. */
export const SHADOW_TILE_POOL_WGSL = tilePoolWgsl('0.0')

/** The camera's footprint (anisotropic taps) and a shadow texel's (one tap at the isotropic level,
 *  the finest fallback), which a reading pass gives the one atlas read (`atlasReadWgsl`). */
const CAMERA_FOOTPRINT: Footprint = { anisotropic: true, finest: false }
const SHADOW_FOOTPRINT: Footprint = { anisotropic: false, finest: true }

/** THE ONE SAMPLING OF AN ATLAS on the textures of `pool`, its footprint the reading pass's, and
 *  the name of its public read: `${k}Sample` for the camera's, `${k}SampleFinest` for a shadow
 *  texel's, which is not a view at a grazing angle. */
const atlasSampleWgsl = (k: string, pool: WgslDecl, finest = false) => {
  const name = finest ? `${k}SampleFinest` : `${k}Sample`
  return { name, decl: atlasReadWgsl(name, k, pool, finest ? SHADOW_FOOTPRINT : CAMERA_FOOTPRINT) }
}

/** Color-atlas sample: `colorSample(slot, uv, ddx, ddy, sampled)`, on the textures of `pool`. The
 *  colour atlas has no two-channel texture; its read is generated all the same, so the two
 *  atlases share one text. */
export const colorSampleWgsl = (pool: WgslDecl) =>
  wgslBlock('COLOR_SAMPLE_WGSL', [atlasSampleWgsl('color', pool).decl], '')
/** The colour sample of the camera's passes (`TILE_POOL_WGSL`). */
export const COLOR_SAMPLE_WGSL = colorSampleWgsl(TILE_POOL_WGSL)

/**
 * Cutout of a masked material: `maskAlpha(slot, uv, ddx, ddy, sampled)`, the base-map alpha at the
 * derivatives of the pass that reads. The camera raster (`finest` false) reads it with the colour's
 * taps but at the render pixel's own footprint: `exp2(-uni.mipBias)` on the derivatives cancels the
 * pool's upscale offset, which sharpens a colour the accumulation averages but, under a hard
 * threshold, turns sub-pixel detail into a 0/1 that flips with every jitter. The shadow pass (`finest` true) gives the one
 * sampling its own footprint (`atlasSampleWgsl`): one tap at the isotropic level, under its
 * fallback rule, which a shadow texel's footprint asks. On the textures of
 * `pool`, the camera's unless given.
 */
export const maskAlphaWgsl = (finest: boolean, pool: WgslDecl = TILE_POOL_WGSL) => {
  const read = atlasSampleWgsl('color', pool, finest)
  const scale = finest ? '' : '*exp2(-uni.mipBias)'
  return wgslBlock(
    `maskAlphaWgsl(${finest})`,
    [read.decl],
    `fn maskAlpha(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->f32{return ${read.name}(slot,uv,ddx${scale},ddy${scale},sampled).w;}`,
  )
}

/** Data-atlas sample of the camera's passes: `dataSample(slot, uv, ddx, ddy, sampled)`. */
export const DATA_SAMPLE_WGSL = wgslBlock(
  'DATA_SAMPLE_WGSL',
  [atlasSampleWgsl('data', TILE_POOL_WGSL).decl],
  '',
)

/** Atlas declarations: one pool per lane and the page table, at the bindings the layout gives, in
 *  `group`. */
export const tileDeclarations = (bindings: AtlasBindings, name: string, group = 0) =>
  `${bindings.lanes
    .map(
      (binding, lane) =>
        `@group(${group}) @binding(${binding}) var ${name}Pool${lane}:texture_2d_array<f32>;`,
    )
    .join('\n')}
@group(${group}) @binding(${bindings.pages}) var<storage,read> ${name}Pages:array<u32>;`

/** What a pass that reads a page's materials declares in group 0: the uvs, the colour atlas and
 *  the sampler of the maps, at the visibility layout's bindings. */
export const materialDeclarations = () =>
  `@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;`
