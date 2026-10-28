import { WRAP_COORD_WGSL } from '../../visibility/wrapModes.ts'
import { PAGE_FILTER_SHIFT, SLOT_BIAS_SHIFT, SLOT_BIAS_STEPS } from './page/pageTable.ts'
import { SAMPLE_SLOT_MASK, SAMPLE_WRAP_SHIFT } from '../texture/sampling.ts'
import { SAMPLING_WGSL } from './sampling/samplingWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { bilinear4 } from '../../../../math/src/wgsl/sampling.ts'

/** The branch that reads the data atlas's channel pool holding one-channel maps: the channel as the
 *  tap names it — in R alone (5), as a grey (6), in all four (7). */
const oneChannelBranch = (k: string) =>
  k === 'data'
    ? ` if(tap>=5u){
  let r=textureSampleLevel(${k}Pool2,mapsSampler,t.uv,t.layer,0.0).x;
  if(tap==5u){return vec4f(r,0.0,0.0,1.0);}
  return select(vec4f(r,r,r,1.0),vec4f(r),tap==7u);
 }
`
    : ''

/** The function `head` of a slot `s` at the level of detail `lod`: the two levels it straddles,
 *  each read by `read` (its level's WGSL expression), mixed by their share; the coarser alone past
 *  the slot's last level. */
export const levelMix = (head: string, lod: string, read: (level: string) => string) =>
  `${head}{
 let l0=floor(${lod});let t=${lod}-l0;
 let a=${read('u32(l0)')};
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${read('u32(l0)+1u')},t);
}`

/** The slot of atlas `k`: its header read into a `TileSlot`. */
const tileSlotText = (k: string) => `fn ${k}Slot(slot:u32)->TileSlot{
 let h=PAGE_HEADER+slot*PAGE_SLOT;
 let first=${k}Pages[h+1u];let last=${k}Pages[h+2u];let tail=${k}Pages[h+3u];let word=last>>${PAGE_FILTER_SHIFT}u;
 return TileSlot(sizeOf(${k}Pages[h]),first&0xffu,last&0xffu,${k}Pages[3]+slot*PAGE_LEVELS,tail&0xffffffu,tail>>24u,word&${SAMPLE_SLOT_MASK}u,(word>>${SAMPLE_WRAP_SHIFT}u)&15u,f32((first>>${SLOT_BIAS_SHIFT}u)&0xffu)/${SLOT_BIAS_STEPS}.0);
}
`

/** The tap read in the pool of a texture's lane. */
const tileTapText = (
  k: string,
) => `/** The tap read in the pool of the texture's lane: lossless (0), RGBA blocks (1), two
 *  channels with Y in the second channel (2) or in the alpha (3), or half-float texels (4), which
 *  the colour atlas holds in its third pool where the data atlas holds its two-channel one: the
 *  texels as they are, past one where the file has them so; and, in the data atlas's third pool when
 *  it holds one-channel maps, one channel in R (5), grey (6) or in all four (7). One hardware sample of the
 *  pool's level 0 — its own bilinear, at the weights it takes in the texture's level
 *  (\`poolAxis\`) —, its footprint in the tile, whose gutter holds the texels past its edge. */
fn ${k}Tap(tap:u32,t:TileTap)->vec4f{
 if(tap==0u){return textureSampleLevel(${k}Pool0,mapsSampler,t.uv,t.layer,0.0);}
 if(tap==4u){return textureSampleLevel(${k}Pool2,mapsSampler,t.uv,t.layer,0.0);}
${oneChannelBranch(k)} if(tap>=2u){
  let v=textureSampleLevel(${k}Pool2,mapsSampler,t.uv,t.layer,0.0);
  let xy=vec2f(v.x,select(v.y,v.w,tap==3u));
  return vec4f(xy,rebuiltZ(xy),1.0);
 }
 return textureSampleLevel(${k}Pool1,mapsSampler,t.uv,t.layer,0.0);
}
`

/** Where a texel lives: the table word of its tile, its place, its fetch. */
const tilePlaceText = (
  k: string,
) => `/** Table word that holds the tile of a texel at a streamed level. */
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
 let res=tileEntryLevel(word);
 let rtexel=pickTexel(levelTexel(uv,levelSize(s.size,res)),nearest);
 let local=rtexel-floor(rtexel/TEXEL_TILE)*TEXEL_TILE;
 return poolTap(placeOrigin(word),local,placeLayer(word));
}
fn ${k}Fetch(s:TileSlot,uv:vec2f,level:u32,nearest:bool)->vec4f{
 var word=0u;
 if(level<s.tail){word=${k}Pages[${k}Entry(s,uv,level)];}
 return ${k}Tap(s.tap,${k}Place(s,uv,level,word,nearest));
}
`

/** One level of a read, and the filtered read of two. */
const tileLevelText = (
  k: string,
) => `/** One level of a read, the coordinate brought back by the texture's addressing nibble: a single
 *  fetch off a seam; on the seam of a repeating period — half a texel of THIS level from either
 *  edge, wider the coarser the level —, the four fetches the sampler's rule mixes, the last texel
 *  and the first, by their weights at this level. A nearest read takes the texel the fold named. */
fn ${k}Level(s:TileSlot,uv:vec2f,level:u32,nearest:bool)->vec4f{
 if(!wrapRepete(s.wrap)){return ${k}Fetch(s,wrapReplie(uv,s.wrap),level,nearest);}
 let t=wrapUv(uv,s.wrap,levelSize(s.size,level));
 if(!t.couture||nearest){return ${k}Fetch(s,t.proche,level,nearest);}
 let s00=${k}Fetch(s,t.proche,level,nearest);
 let s10=${k}Fetch(s,vec2f(t.loin.x,t.proche.y),level,nearest);
 let s01=${k}Fetch(s,vec2f(t.proche.x,t.loin.y),level,nearest);
 let s11=${k}Fetch(s,t.loin,level,nearest);
 return bilinear4(s00,s10,s01,s11,t.poids);
}
/** Filtered read: the two levels the footprint straddles, mixed by their share. */
${levelMix(
  `fn ${k}Blend(s:TileSlot,uv:vec2f,lod:f32,nearest:bool)->vec4f`,
  'lod',
  (level) => `${k}Level(s,uv,${level},nearest)`,
)}`

/**
 * Atlas reads, generated by name: the `${k}Pages` buffer and the `${k}Pool*` textures cannot be
 * passed as WGSL arguments, so each atlas has its own functions, from the same text, on the
 * textures of `pool` (`tilePoolWgsl`).
 */
export const tileKindWgsl = (k: string, pool: WgslDecl) =>
  wgslBlock(
    `tileKindWgsl(${k})`,
    [pool, SAMPLING_WGSL, WRAP_COORD_WGSL, bilinear4],
    `${tileSlotText(k)}${tileTapText(k)}${tilePlaceText(k)}${tileLevelText(k)}`,
  )
