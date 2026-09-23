import { WRAP_COORD_WGSL } from '../../visibility/wrapModes.ts';
import type { AtlasBindings } from '../core/bindLayout.ts';
import {
  MAX_LEVELS,
  POOL_LAYER_SIDE,
  TILE_BORDER,
  TILE_PITCH,
  TILE_SIZE,
} from '../../texture/tiles.ts';
import { PAGE_HEADER_WORDS, PAGE_SAMPLING_WORD, PAGE_SLOT_WORDS } from './pageTable.ts';
import { SAMPLING_WGSL, samplingReadWgsl } from './sampling.ts';

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
 * Two variants measured and discarded at 2496×1404 on Emerald (materials pass 5.64 ms): the table
 * bound as `vec4<u32>`, the header packed in one word — 5.70 ms, no effect; the level address
 * recomputed in a loop instead of being read — 6.5 ms, the divergent arithmetic costs more than the
 * read it avoids.
 *
 * A texture's sampling — UV transform, filters, anisotropy — rides in the same header and is
 * read once with it (`sampling.ts`, `SAMPLING_WGSL`).
 *
 * Coordinates are clamped to the half-texel of the level being read: linear filtering therefore never
 * leaves a level's texels, nor a tail tile toward its neighbour, and the seam of a repeating period
 * remains the one `wrapUv` mixes by hand.
 *
 * An atlas has one pool per LANE — lossless RGBA8, RGBA blocks, two-channel blocks — and a
 * texture's header names the TAP every tile of it takes (`../../texture/blockFormats.ts`, `tapOf`): the
 * pool it samples, the same place arithmetic on each, and for a two-channel block which channel
 * holds Y — the second for BC5, the alpha for the ASTC luminance-alpha block. A two-channel read
 * is a normal map's X and Y, Z rebuilt as the reference does from a two-channel map — the
 * unit-length remainder —, so what the material receives is the three-channel map it would have
 * read from a lossless lane.
 *
 * The host shader declares one `${k}Pool<lane>` per lane in `POOL_LANES` order — `colorPool0`,
 * `colorPool1`, `colorPool2`, the same for `data` —, `mapsSampler`, `colorPages` and `dataPages`,
 * at the bindings `../core/bindEntries.ts` publishes.
 */
export const TILE_POOL_WGSL = `${WRAP_COORD_WGSL}
const TEXEL_TILE:f32=${TILE_SIZE}.0;
const TEXEL_PITCH:f32=${TILE_PITCH}.0;
const TEXEL_BORDER:f32=${TILE_BORDER}.0;
const POOL_SIDE:f32=${POOL_LAYER_SIDE}.0;
const PAGE_HEADER:u32=${PAGE_HEADER_WORDS}u;
const PAGE_SLOT:u32=${PAGE_SLOT_WORDS}u;
const PAGE_LEVELS:u32=${MAX_LEVELS}u;
const PAGE_SAMPLING:u32=${PAGE_SAMPLING_WORD}u;
struct TileTap{uv:vec2f,layer:i32,}
/** A texture header: size, first tail level, last level, the word where its level addresses begin,
 *  the tail's placement, the tap of its pool, its sampling word. */
struct TileSlot{size:vec2f,tail:u32,last:u32,levels:u32,tailWord:u32,tap:u32,sampling:u32,}
/** A normal map's Z from its X and Y, as the map stores them (0..1), for a two-channel lane. */
fn rebuiltZ(xy:vec2f)->f32{let n=xy*2.0-1.0;return (sqrt(max(0.0,1.0-dot(n,n)))+1.0)*0.5;}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20));}
${SAMPLING_WGSL}
/** Coordinate brought back into the texture by its addressing nibble, near side of a seam. */
fn slotWrapped(s:TileSlot,uv:vec2f,wrap:u32)->vec2f{
 if(!wrapRepete(wrap)){return wrapReplie(uv,wrap);}
 return wrapUv(uv,wrap,s.size).proche;
}
fn tailOffset(rank:u32)->f32{return f32((${TILE_SIZE}u-(${TILE_SIZE}u>>rank)+3u)&~3u);}
fn placeOrigin(word:u32)->vec2f{return vec2f(f32(word&0xffu),f32((word>>8u)&0xffu))*TEXEL_PITCH+TEXEL_BORDER;}
fn placeLayer(word:u32)->i32{return i32((word>>16u)&0xffu);}
fn sizeOf(word:u32)->vec2f{return vec2f(f32(word&0xffffu),f32(word>>16u));}
fn levelSize(size:vec2f,level:u32)->vec2f{return max(floor(size/exp2(f32(level))),vec2f(1.0));}
fn levelTexel(uv:vec2f,lsize:vec2f)->vec2f{return clamp(uv*lsize,vec2f(0.5),lsize-0.5);}
/** Entry of a texel in its level: its tile, in tile rows. */
fn tileEntry(texel:vec2f,lsize:vec2f)->u32{return u32(texel.y/TEXEL_TILE)*u32(ceil(lsize.x/TEXEL_TILE))+u32(texel.x/TEXEL_TILE);}
`;

/**
 * Atlas reads, generated by name: the `${k}Pages` buffer and the `${k}Pool*` textures cannot be
 * passed as WGSL arguments, so each atlas has its own functions, from the same text.
 */
const kind = (k: string) => `fn ${k}Slot(slot:u32)->TileSlot{
 let h=PAGE_HEADER+slot*PAGE_SLOT;
 let tail=${k}Pages[h+3u];
 return TileSlot(sizeOf(${k}Pages[h]),${k}Pages[h+1u],${k}Pages[h+2u],${k}Pages[3]+slot*PAGE_LEVELS,tail&0xffffffu,tail>>24u,${k}Pages[h+PAGE_SAMPLING]);
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
  return TileTap((origin+rtexel)/POOL_SIDE,placeLayer(s.tailWord));
 }
 let res=(word>>24u)&0x7fu;
 let rtexel=pickTexel(levelTexel(uv,levelSize(s.size,res)),nearest);
 let local=rtexel-floor(rtexel/TEXEL_TILE)*TEXEL_TILE;
 return TileTap((placeOrigin(word)+local)/POOL_SIDE,placeLayer(word));
}
fn ${k}Fetch(s:TileSlot,uv:vec2f,level:u32,finest:bool,nearest:bool)->vec4f{
 var word=0u;
 if(level<s.tail){
  word=${k}Pages[${k}Entry(s,uv,level)];
  if(finest&&word==0u){word=${k}Pages[${k}Entry(s,uv,0u)];}
 }
 return ${k}Tap(s.tap,${k}Place(s,uv,level,word,nearest));
}
/** Filtered read: the two levels the footprint straddles, mixed by their share. */
fn ${k}Blend(s:TileSlot,uv:vec2f,r:TileRead,finest:bool)->vec4f{
 let l0=floor(r.lod);let t=r.lod-l0;
 let a=${k}Fetch(s,uv,u32(l0),finest,r.nearest);
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Fetch(s,uv,u32(l0)+1u,finest,r.nearest),t);
}
fn ${k}SampleAt(s:TileSlot,uv:vec2f,r:TileRead)->vec4f{return ${k}Blend(s,uv,r,false);}`;

/**
 * Public atlas read: `wrap` is the addressing nibble of the map being sampled. The header is read
 * once, the coordinate goes through the texture's transform (`${k}Read`), then each anisotropic tap
 * is one read off a seam, four mixed on the seam of a repeating period, where the sampler's rule
 * would mix the last texel and the first: it is the read that wraps, not the coordinate. A nearest
 * read takes the texel the fold named, seam or not. `name + 'At'` is the read that `name`
 * dispatches, `name + 'Tap'` one tap of it.
 */
const wrapped = (name: string, k: string, out: string) => {
  const at = `${name}At`,
    tap = `${name}Tap`;
  return `fn ${tap}(s:TileSlot,r:TileRead,uv:vec2f,wrap:u32)->${out}{
 if(!wrapRepete(wrap)){return ${at}(s,wrapReplie(uv,wrap),r);}
 let t=wrapUv(uv,wrap,s.size);
 if(!t.couture||r.nearest){return ${at}(s,t.proche,r);}
 let s00=${at}(s,t.proche,r);
 let s10=${at}(s,vec2f(t.loin.x,t.proche.y),r);
 let s01=${at}(s,vec2f(t.proche.x,t.loin.y),r);
 let s11=${at}(s,t.loin,r);
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}
fn ${name}(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f)->${out}{
 let s=${k}Slot(slot);
 let r=${k}Read(slot,s,uv,ddx,ddy);
 if(r.taps<=1u){return ${tap}(s,r,r.uv,wrap);}
 var sum=${out}();
 let n=f32(r.taps);
 for(var i=0u;i<r.taps;i++){sum+=${tap}(s,r,r.uv+r.axis*((f32(i)+0.5)/n-0.5),wrap);}
 return sum/n;
}`;
};

/** Color-atlas sample: `colorSample(slot, uv, wrap, ddx, ddy)`. The colour atlas has no
 *  two-channel texture; its read is generated all the same, so the two atlases share one text. */
export const COLOR_SAMPLE_WGSL = `${kind('color')}
${wrapped('colorSample', 'color', 'vec4f')}`;

/**
 * Cutout of a masked material: `maskAlpha(slot, uv, wrap, ddx, ddy)`, the base-map alpha read
 * exactly as the materials pass reads its colour — same level, same mix — at the derivatives of the
 * pass that reads. `finest` is the shadow pass's fallback rule (see the header); the camera raster
 * does not have it: its tiles are the ones it requested. Requires `COLOR_SAMPLE_WGSL`.
 */
export const maskAlphaWgsl = (finest: boolean) =>
  `fn maskAlphaAt(s:TileSlot,uv:vec2f,r:TileRead)->f32{return colorBlend(s,uv,r,${finest}).w;}
${wrapped('maskAlpha', 'color', 'f32')}`;

/** Data-atlas sample: `dataSample(slot, uv, wrap, ddx, ddy)`. */
export const DATA_SAMPLE_WGSL = `${kind('data')}
${wrapped('dataSample', 'data', 'vec4f')}`;

/** Atlas declarations: one pool per lane and the page table, at the bindings the layout gives. */
export const tileDeclarations = (bindings: AtlasBindings, name: string) =>
  `${bindings.lanes
    .map(
      (binding, lane) =>
        `@group(0) @binding(${binding}) var ${name}Pool${lane}:texture_2d_array<f32>;`,
    )
    .join('\n')}
@group(0) @binding(${bindings.pages}) var<storage,read> ${name}Pages:array<u32>;`;
