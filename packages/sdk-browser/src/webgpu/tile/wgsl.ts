import { WRAP_COORD_WGSL } from '../../visibility/wrapModes.ts'
import type { AtlasBindings } from '../core/bindLayout.ts'
import {
  MAX_LEVELS,
  PLACE_AXIS_BITS,
  PLACE_LAYER_BITS,
  POOL_STEP,
  POOL_SUBTEXEL,
  TILE_BORDER,
  TILE_PITCH,
  TILE_SIZE,
} from '../../texture/tiles.ts'
import {
  PAGE_FILTER_SHIFT,
  PAGE_HEADER_WORDS,
  PAGE_SLOT_WORDS,
  PAGE_TRANSFORM_WORD,
} from './pageTable.ts'
import { SAMPLE_WRAP_SHIFT } from '../../texture/sampling.ts'
import { SAMPLING_WGSL, samplingReadWgsl, atlasReadWgsl } from './samplingWgsl.ts'

/** A place's column-or-row and layer fields in a table word (`packPlace`). */
const AXIS_MASK = (1 << PLACE_AXIS_BITS) - 1,
  LAYER_MASK = (1 << PLACE_LAYER_BITS) - 1

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
 * A texture's header — size, tail, last level, tail placement — is read ONCE per sample (`TileSlot`),
 * not once per tap: each of the two taps of a mix only adds its level address and its entry. On a
 * foliage pixel that is the difference between a chain of twelve dependent reads and a chain of six.
 * Two variants measured and discarded at 2496×1404 (materials pass 5.64 ms): the table
 * bound as `vec4<u32>`, the header packed in one word — 5.70 ms, no effect; the level address
 * recomputed in a loop instead of being read — 6.5 ms, the divergent arithmetic costs more than the
 * read it avoids.
 *
 * A texture's sampling — addressing, filters, anisotropy, UV transform — rides in the same header
 * (`sampling.ts`): its filter word and addressing nibble share the last-level word, so a read
 * fetches no more words than before. Whether the filter rule runs is the page's, not the
 * sample's (`sampled`, `samplingWgsl.ts`): a page at the default filters takes the same read, and
 * the resolve does not even compile the other.
 *
 * Coordinates are clamped to the half-texel of the level being read: linear filtering therefore never
 * leaves a level's texels, nor a tail tile toward its neighbour, and the seam of a repeating period
 * is the one `wrapUv` mixes by hand — at each level read, on that level's size (`${k}Level`), as
 * the sampler of a mip chain mixes a level's last texel and its first.
 *
 * An atlas has one pool per LANE — lossless RGBA8, RGBA blocks, two-channel blocks — and a
 * texture's header names the TAP every tile of it takes (`../../texture/blockFormats.ts`, `tapOf`):
 * the pool it samples, the same place arithmetic on each, and for a two-channel block which
 * channel holds Y — the second for BC5, the alpha for the ASTC luminance-alpha block. A
 * two-channel read is a normal map's X and Y, Z rebuilt from the two channels as the unit-length
 * remainder —, so what the material receives is the three-channel map it would have read from a
 * lossless lane.
 *
 * The host shader declares one `${k}Pool<lane>` per lane in `POOL_LANES` order — `colorPool0`,
 * `colorPool1`, `colorPool2`, the same for `data` —, `mapsSampler`, `colorPages` and `dataPages`,
 * at the bindings `../core/bindEntries.ts` publishes.
 *
 * `mipBias` is the WGSL expression every level choice adds to its LOD (`atlasLod`), the read's and
 * the request's alike: a frame drawn below the display adds `log2(render / display)`, so a texture
 * keeps the texel density it has at native size (`../../taa/jitter.ts`, `upscaleMipBias`).
 */
export const tilePoolWgsl = (mipBias: string) => `${WRAP_COORD_WGSL}
const TEXEL_TILE:f32=${TILE_SIZE}.0;
const TEXEL_PITCH:f32=${TILE_PITCH}.0;
const TEXEL_BORDER:f32=${TILE_BORDER}.0;
const POOL_SUBTEXEL:f32=${POOL_SUBTEXEL}.0;
const POOL_STEP:f32=1.0/${1 / POOL_STEP}.0;
const PAGE_HEADER:u32=${PAGE_HEADER_WORDS}u;
const PAGE_SLOT:u32=${PAGE_SLOT_WORDS}u;
const PAGE_LEVELS:u32=${MAX_LEVELS}u;
const PAGE_TRANSFORM:u32=${PAGE_TRANSFORM_WORD}u;
struct TileTap{uv:vec2f,layer:i32,}
/** A texture header: size, first tail level, last level, the word where its level addresses begin,
 *  the tail's placement, the tap of its pool, its filter word and its addressing nibble
 *  (\`sampling.ts\`). */
struct TileSlot{size:vec2f,tail:u32,last:u32,levels:u32,tailWord:u32,tap:u32,sampling:u32,wrap:u32,}
/** A normal map's Z from its X and Y, as the map stores them (0..1), for a two-channel lane. */
fn rebuiltZ(xy:vec2f)->f32{let n=xy*2.0-1.0;return (sqrt(max(0.0,1.0-dot(n,n)))+1.0)*0.5;}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20))+${mipBias};}
/** LOD a footprint asks of a texture, clamped to its levels: the single rule for choosing a level
 *  of a texture at the default filters, for the read as for the request. */
fn slotLod(s:TileSlot,ddx:vec2f,ddy:vec2f)->f32{return clamp(atlasLod(ddx*s.size,ddy*s.size),0.0,f32(s.last));}
${SAMPLING_WGSL}
/** Coordinate brought back into the texture by its addressing nibble, near side of a seam. */
fn slotWrapped(s:TileSlot,uv:vec2f)->vec2f{
 if(!wrapRepete(s.wrap)){return wrapReplie(uv,s.wrap);}
 return wrapUv(uv,s.wrap,s.size).proche;
}
/** Pool coordinate of a texel at \`texel\` from a tile's \`origin\`, counted in 2^-24 steps: exact
 *  in f32 at every place (\`POOL_LAYER_SIDE\`, \`../../texture/tiles.ts\`), with no division. */
fn poolAxis(origin:f32,texel:f32)->f32{return (origin*POOL_SUBTEXEL+round(texel*POOL_SUBTEXEL))*POOL_STEP;}
fn poolTap(origin:vec2f,texel:vec2f,layer:i32)->TileTap{return TileTap(vec2f(poolAxis(origin.x,texel.x),poolAxis(origin.y,texel.y)),layer);}
fn tailOffset(rank:u32)->f32{return f32((${TILE_SIZE}u-(${TILE_SIZE}u>>rank)+3u)&~3u);}
fn placeOrigin(word:u32)->vec2f{return vec2f(f32(word&${AXIS_MASK}u),f32((word>>${PLACE_AXIS_BITS}u)&${AXIS_MASK}u))*TEXEL_PITCH+TEXEL_BORDER;}
fn placeLayer(word:u32)->i32{return i32((word>>${2 * PLACE_AXIS_BITS}u)&${LAYER_MASK}u);}
fn sizeOf(word:u32)->vec2f{return vec2f(f32(word&0xffffu),f32(word>>16u));}
/** Size of a level, \`max(size >> level, 1)\` as the CPU lays it out (\`../../texture/tiles.ts\`): the
 *  size times 2^-level built from its exponent bits — exact, where \`exp2\` may stray by ULPs —, 0
 *  from level 127 on, as the division by 2^level gave. */
fn levelSize(size:vec2f,level:u32)->vec2f{return max(floor(size*bitcast<f32>((127u-min(level,127u))<<23u)),vec2f(1.0));}
fn levelTexel(uv:vec2f,lsize:vec2f)->vec2f{return clamp(uv*lsize,vec2f(0.5),lsize-0.5);}
/** Entry of a texel in its level: its tile, in tile rows. */
fn tileEntry(texel:vec2f,lsize:vec2f)->u32{return u32(texel.y/TEXEL_TILE)*u32(ceil(lsize.x/TEXEL_TILE))+u32(texel.x/TEXEL_TILE);}
`
/** The pool of the camera's passes — visibility, compute raster, surfaces, transparents —, whose
 *  uniform `uni` carries the frame's texture level offset. */
export const TILE_POOL_WGSL = tilePoolWgsl('uni.mipBias')

/**
 * Atlas reads, generated by name: the `${k}Pages` buffer and the `${k}Pool*` textures cannot be
 * passed as WGSL arguments, so each atlas has its own functions, from the same text.
 */
const kind = (k: string) => `fn ${k}Slot(slot:u32)->TileSlot{
 let h=PAGE_HEADER+slot*PAGE_SLOT;
 let last=${k}Pages[h+2u];let tail=${k}Pages[h+3u];let word=last>>${PAGE_FILTER_SHIFT}u;
 return TileSlot(sizeOf(${k}Pages[h]),${k}Pages[h+1u],last&0xffu,${k}Pages[3]+slot*PAGE_LEVELS,tail&0xffffffu,tail>>24u,word&${(1 << SAMPLE_WRAP_SHIFT) - 1}u,word>>${SAMPLE_WRAP_SHIFT}u);
}
${samplingReadWgsl(k)}
/** The tap read in the pool of the texture's lane: lossless (0), RGBA blocks (1), or two
 *  channels with Y in the second channel (2) or in the alpha (3). */
fn ${k}Tap(tap:u32,t:TileTap)->vec4f{
 if(tap==0u){return textureSampleLevel(${k}Pool0,mapsSampler,t.uv,t.layer,0.0);}
 if(tap>=2u){
  let v=textureSampleLevel(${k}Pool2,mapsSampler,t.uv,t.layer,0.0);
  let xy=vec2f(v.x,select(v.y,v.w,tap==3u));
  return vec4f(xy,rebuiltZ(xy),1.0);
 }
 return textureSampleLevel(${k}Pool1,mapsSampler,t.uv,t.layer,0.0);
}
/** Table word that holds the tile of a texel at a streamed level. */
fn ${k}Entry(s:TileSlot,uv:vec2f,level:u32)->u32{
 let lsize=levelSize(s.size,level);
 return ${k}Pages[s.levels+level]+tileEntry(levelTexel(uv,lsize),lsize);
}
/** Where to read a texel whose word is known: the tile it names, or the tail at the requested level. */
fn ${k}Place(s:TileSlot,uv:vec2f,level:u32,word:u32,nearest:bool)->TileTap{
 if(word==0u){
  let res=max(level,s.tail);
  let rtexel=pickTexel(levelTexel(uv,levelSize(s.size,res)),nearest);
  let origin=placeOrigin(s.tailWord)+vec2f(tailOffset(res-s.tail),0.0);
  return poolTap(origin,rtexel,placeLayer(s.tailWord));
 }
 let res=(word>>24u)&0x7fu;
 let rtexel=pickTexel(levelTexel(uv,levelSize(s.size,res)),nearest);
 let local=rtexel-floor(rtexel/TEXEL_TILE)*TEXEL_TILE;
 return poolTap(placeOrigin(word),local,placeLayer(word));
}
fn ${k}Fetch(s:TileSlot,uv:vec2f,level:u32,finest:bool,nearest:bool)->vec4f{
 var word=0u;
 if(level<s.tail){
  word=${k}Pages[${k}Entry(s,uv,level)];
  if(finest&&word==0u){word=${k}Pages[${k}Entry(s,uv,0u)];}
 }
 return ${k}Tap(s.tap,${k}Place(s,uv,level,word,nearest));
}
/** One level of a read, the coordinate brought back by the texture's addressing nibble: a single
 *  fetch off a seam; on the seam of a repeating period — half a texel of THIS level from either
 *  edge, wider the coarser the level —, the four fetches the sampler's rule mixes, the last texel
 *  and the first, by their weights at this level. A nearest read takes the texel the fold named. */
fn ${k}Level(s:TileSlot,uv:vec2f,level:u32,finest:bool,nearest:bool)->vec4f{
 if(!wrapRepete(s.wrap)){return ${k}Fetch(s,wrapReplie(uv,s.wrap),level,finest,nearest);}
 let t=wrapUv(uv,s.wrap,levelSize(s.size,level));
 if(!t.couture||nearest){return ${k}Fetch(s,t.proche,level,finest,nearest);}
 let s00=${k}Fetch(s,t.proche,level,finest,nearest);
 let s10=${k}Fetch(s,vec2f(t.loin.x,t.proche.y),level,finest,nearest);
 let s01=${k}Fetch(s,vec2f(t.proche.x,t.loin.y),level,finest,nearest);
 let s11=${k}Fetch(s,t.loin,level,finest,nearest);
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}
/** Filtered read: the two levels the footprint straddles, mixed by their share. */
fn ${k}Blend(s:TileSlot,uv:vec2f,lod:f32,nearest:bool,finest:bool)->vec4f{
 let l0=floor(lod);let t=lod-l0;
 let a=${k}Level(s,uv,u32(l0),finest,nearest);
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Level(s,uv,u32(l0)+1u,finest,nearest),t);
}
fn ${k}SampleAt(s:TileSlot,uv:vec2f,lod:f32,nearest:bool)->vec4f{return ${k}Blend(s,uv,lod,nearest,false);}`

/** Color-atlas sample: `colorSample(slot, uv, ddx, ddy, sampled)`. The colour atlas has no
 *  two-channel texture; its read is generated all the same, so the two atlases share one text. */
export const COLOR_SAMPLE_WGSL = `${kind('color')}
${atlasReadWgsl('colorSample', 'color', 'vec4f', true)}`

/**
 * Cutout of a masked material: `maskAlpha(slot, uv, ddx, ddy, sampled)`, the base-map alpha at the
 * derivatives of the pass that reads. The camera raster (`finest` false) reads it as the colour
 * reads — same transform, filter, anisotropic taps and mix, `colorSample`'s own `.w` —: the
 * silhouette the raster cuts is the one its hardware sampler reads, and the resolve that
 * shades the kept pixel reads the same taps. The shadow pass (`finest` true) reads one tap at
 * the isotropic level, under its fallback rule (see the header): a shadow texel's footprint is
 * not a view at a grazing angle, and it does not pay for anisotropy's taps. Requires
 * `COLOR_SAMPLE_WGSL`.
 */
export const maskAlphaWgsl = (finest: boolean) =>
  finest
    ? `fn maskAlphaAt(s:TileSlot,uv:vec2f,lod:f32,nearest:bool)->f32{return colorBlend(s,uv,lod,nearest,true).w;}
${atlasReadWgsl('maskAlpha', 'color', 'f32', false)}`
    : 'fn maskAlpha(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->f32{return colorSample(slot,uv,ddx,ddy,sampled).w;}'

/** Data-atlas sample: `dataSample(slot, uv, ddx, ddy, sampled)`. */
export const DATA_SAMPLE_WGSL = `${kind('data')}
${atlasReadWgsl('dataSample', 'data', 'vec4f', true)}`

/** Atlas declarations: one pool per lane and the page table, at the bindings the layout gives. */
export const tileDeclarations = (bindings: AtlasBindings, name: string) =>
  `${bindings.lanes
    .map(
      (binding, lane) =>
        `@group(0) @binding(${binding}) var ${name}Pool${lane}:texture_2d_array<f32>;`,
    )
    .join('\n')}
@group(0) @binding(${bindings.pages}) var<storage,read> ${name}Pages:array<u32>;`
