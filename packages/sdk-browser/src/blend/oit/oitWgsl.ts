import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { packLight, unpackLight } from '../../gpu/core/smallFloatWgsl.ts'
import { ORDER_WORD, TRI_CHANNELS_SHIFT, WORDS } from '../vertexReadsWgsl.ts'
import {
  OIT_GLOBAL_DEMAND,
  OIT_GLOBAL_NODES,
  OIT_GLOBAL_WORDS,
  OIT_GROUP,
  OIT_HEADER_COUNT,
  OIT_HEADER_HEAD,
  OIT_HEADER_SPILL_LIGHT,
  OIT_HEADER_SPILL_SAT,
  OIT_HEADER_SPILL_TRANS,
  OIT_HEADER_WORDS,
  OIT_LIST_BOUND,
  OIT_MAX_SAMPLES,
  OIT_NODE_COLOUR,
  OIT_NODE_DEPTH,
  OIT_NODE_KEY,
  OIT_NODE_NEXT,
  OIT_NODE_TRANS,
  OIT_NODE_TRI,
  OIT_NODE_WORDS,
  OIT_RUN,
  OIT_RUNS,
  OIT_SLOT_WORDS,
  OIT_SPILL_LIGHT_MAX,
  OIT_SPILL_SCALE,
  OIT_SPILL_TOP,
  OIT_SPILL_TRANS_BITS,
  OIT_PARAMS,
} from './oitLayout.ts'

/** The largest light a kept sample holds (a half float's). */
const OIT_LIGHT_CLAMP = 65504

/** The depth the collecting fragments are tested against, `oitSceneDepth(pixel)`, read from the texture the collect group binds; a program whose device cannot spare the texture reads it from the packed table instead (`foldOitDepth`). */
export const OIT_DEPTH_TEXTURE_WGSL = wgslBlock(
  'OIT_DEPTH_TEXTURE_WGSL',
  [],
  `@group(${OIT_GROUP}) @binding(2) var oitDepth:texture_depth_2d;
fn oitSceneDepth(pixel:vec2u)->f32{return textureLoad(oitDepth,vec2i(pixel),0);}`,
)

/**
 * THE FRAGMENTS OF A PIXEL, PACKED (`oitLayout.ts` says where they lie): a fragment is its light (the colour it adds, already weighed by
 * its opacity), its transmittance (what it lets through, per channel) and its depth. The depth is the float's own bits; the two colours are
 * the engine's 11-11-10 word (`packLight`), which keeps the light of a layer to a few percent and costs one word each. `oitClean` is the
 * one hold the packing takes a light by: no NaN, from 0 to what a kept sample holds.
 */
export const OIT_PACK_WGSL = wgslBlock(
  'OIT_PACK_WGSL',
  [packLight, unpackLight],
  `struct OitFrag{colour:vec3f,depth:f32,trans:vec3f,}
fn oitClean(c:vec3f)->vec3f{return min(max(select(vec3f(0.0),c,c==c),vec3f(0.0)),vec3f(${OIT_LIGHT_CLAMP}.0));}
fn oitPack(c:vec3f)->u32{return packLight(oitClean(c));}
// The spill's fixed point (oitLayout.ts): a fragment's light per channel, held to what a sum of them can hold, and the negative logarithm of its transmittance, in units of 1/scale.
// Each value rounds up or down by a hash of the fragment's order key pair (a stochastic rounding, the same every image and whatever order the fragments arrive in), so that the sum of many small values is unbiased: a rounding to the nearest would take every light under half a unit to nothing and every transmittance near one to one. The hash is a Weyl sequence of the pair (two odd golden multiplies, a salt a channel), so that the roundings of the fragments of a pixel, whose keys run on, are spread evenly over the unit and their errors cancel.
fn oitSpillDither(key:vec2u,salt:vec3u)->vec3f{
 let h=key.x*0x9e3779b9u+key.y*0x7f4a7c15u+salt;
 return vec3f(h>>vec3u(8u))*(1.0/16777216.0);
}
fn oitSpillRound(x:vec3f,r:vec3f)->vec3u{
 let down=floor(x);
 return vec3u(down+select(vec3f(0.0),vec3f(1.0),x-down>r));
}
fn oitSpillLightFixed(c:vec3f,key:vec2u)->vec3u{return oitSpillRound(min(oitClean(c),vec3f(${OIT_SPILL_LIGHT_MAX}.0))*${OIT_SPILL_SCALE}.0,oitSpillDither(key,vec3u(0x0u,0x6a09e667u,0xbb67ae85u)));}
fn oitSpillTransFixed(t:vec3f,key:vec2u)->vec3u{
 let held=min(max(select(vec3f(1.0),t,t==t),vec3f(exp2(-${OIT_SPILL_TRANS_BITS}.0))),vec3f(1.0));
 return oitSpillRound(-log2(held)*${OIT_SPILL_SCALE}.0,oitSpillDither(key,vec3u(0x3c6ef372u,0xa54ff53au,0x510e527fu)));
}
// A sum read back: a sum that wrapped past its 32 bits (its flag) is the top, 2 to the 32 minus one units.
fn oitSpillValue(word:u32,flags:u32,bit:u32)->f32{return f32(select(word,${OIT_SPILL_TOP}u,(flags&(1u<<bit))!=0u))/${OIT_SPILL_SCALE}.0;}
fn oitSpillLightOf(w:vec3u,flags:u32)->vec3f{return vec3f(oitSpillValue(w.x,flags,0u),oitSpillValue(w.y,flags,1u),oitSpillValue(w.z,flags,2u));}
fn oitSpillTransOf(w:vec3u,flags:u32)->vec3f{return exp2(-vec3f(oitSpillValue(w.x,flags,3u),oitSpillValue(w.y,flags,4u),oitSpillValue(w.z,flags,5u)));}
// The multi-layer merge of a fragment behind the last stored one: its light seen through the last one's transmittance, the transmittances
// multiplied, the depth the nearer.
fn oitMerge(last:OitFrag,behind:OitFrag)->OitFrag{
 var m=last;
 m.colour=last.colour+last.trans*behind.colour;
 m.trans=saturate(last.trans*behind.trans);
 m.depth=min(last.depth,behind.depth);
 return m;
}
// Whether a fragment of this depth is dropped: it lies behind the last stored one, which lets less than the threshold through in every channel.
fn oitHidden(last:OitFrag,depth:f32,threshold:f32)->bool{return depth>last.depth&&all(last.trans<vec3f(threshold));}`,
)

/**
 * The multi-layer insertion of one fragment into the array of the nearest `samples` (`oitKept`, `oitCount` of them), as the reference's
 * raster-ordered insertion does it: a fragment behind the last stored one whose merged transmittance is under the threshold in every channel is
 * dropped; else it is inserted by depth, and the one the array pushes out (the farthest, the fragment itself when it is behind them all) is
 * merged into the last by `oitMerge` when the array is full, stored at the end when it is not.
 */
export const OIT_INSERT_WGSL = wgslBlock(
  'OIT_INSERT_WGSL',
  [OIT_PACK_WGSL],
  `var<private> oitKept:array<OitFrag,${OIT_MAX_SAMPLES}>;
var<private> oitCount:u32=0u;
fn oitInsert(fragment:OitFrag,samples:u32,threshold:f32){
 var cur=fragment;
 if(oitCount>0u&&oitHidden(oitKept[oitCount-1u],cur.depth,threshold)){return;}
 for(var j=0u;j<oitCount;j++){
  if(cur.depth<oitKept[j].depth){let held=oitKept[j];oitKept[j]=cur;cur=held;}
 }
 if(oitCount>=samples){oitKept[samples-1u]=oitMerge(oitKept[samples-1u],cur);}
 else{oitKept[oitCount]=cur;oitCount++;}
}`,
)

/** The parameters' struct and the address helpers both programs read the buffer by; each declares `oitParams`. */
const ADDRESS = wgslBlock(
  'OIT_ADDRESS_WGSL',
  [OIT_PACK_WGSL],
  `${OIT_PARAMS.wgsl}
// A reference to a fragment's first word: a word of the head buffer, or of the pool buffer where the top bit is set.
const OIT_POOL_BIT:u32=0x80000000u;
fn oitHeaderAt(pix:u32)->u32{return ${OIT_GLOBAL_WORDS}u+pix*${OIT_HEADER_WORDS}u;}
fn oitPixOf(header:u32)->u32{return (header-${OIT_GLOBAL_WORDS}u)/${OIT_HEADER_WORDS}u;}
// A slot of a pixel: the first oitParams.low slots lie after the headers of the head buffer, the others at the start of the pool buffer.
fn oitSlotRef(pix:u32,slot:u32)->u32{
 if(slot<oitParams.low){return ${OIT_GLOBAL_WORDS}u+oitParams.pixels*${OIT_HEADER_WORDS}u+(pix*oitParams.low+slot)*${OIT_SLOT_WORDS}u;}
 return ((pix*(oitParams.samples-oitParams.low)+slot-oitParams.low)*${OIT_SLOT_WORDS}u)|OIT_POOL_BIT;
}
// A node of the pool is the index plus one (0 is none).
fn oitNodeRef(node:u32)->u32{return ((oitParams.pixels*(oitParams.samples-oitParams.low)*${OIT_SLOT_WORDS}u)+(node-1u)*${OIT_NODE_WORDS}u)|OIT_POOL_BIT;}
// The figures of a pixel, in the pool buffer.
fn oitDebugAt()->u32{return oitParams.pixels*(oitParams.samples-oitParams.low)*${OIT_SLOT_WORDS}u+oitParams.nodes*${OIT_NODE_WORDS}u;}`,
)

/**
 * THE COLLECTION, the fragment stage of the blend module that draws the layers of the modes it sorts (`normal`, `additive`) in place
 * of blending them: the layer's fragment is lit as the blend stage lights it, and its light and transmittance (one minus its opacity, for
 * the additive layers too) are put in the pixel's storage instead of being blended (`fsBlendOit`); its output writes nothing. A fragment the
 * depth the blended path tests against hides adds nothing — the test is made here, for a shader that writes memory may run before the depth
 * test. Every fragment is kept (whatever the method: the combination always merges as the reference does) with the order key its primitive
 * carries (`oitOrder.ts`): the count of the pixel's fragments is taken by an atomic add, and the first `samples` take the slots the pixel
 * owns, the others up to `OIT_LIST_BOUND` a node of the pool by an atomic add, linked at the head of the pixel's list by an atomic exchange. There
 * is no lock and no wait, and no order between fragments: the combination sorts them. A fragment past the bound, or one the pool has no node for
 * (the pool is grown to the demand counted, a few images late), is never dropped: it is summed into the pixel's spill (`oitSpill`), light per channel
 * in a fixed point and transmittance as the fixed point of its negative logarithm, by atomic adds that commute: the spill of a given set of fragments is
 * the same whatever the order they arrive in. Which fragments are in that set depends on the arrival order (the ones past the bound, the ones the pool
 * had no node for). A sum that wraps past its 32 bits sets its flag (`OIT_HEADER_SPILL_SAT`) and reads as the top.
 * A fragment of an invocation that covers no sample of the primitive (a helper invocation, whose atomics are undefined) adds nothing: the reference
 * returns early there too, for the wait of its raster-ordered view hangs the GPU (the return of its insertion, the comment that says it avoids a hang).
 */
export const oitCollectWgsl = (
  shade: { readonly entry: string },
  depthRead = OIT_DEPTH_TEXTURE_WGSL,
) =>
  wgslBlock(
    `oitCollectWgsl(${depthRead.name})`,
    [OIT_PACK_WGSL, ADDRESS, depthRead],
    `@group(${OIT_GROUP}) @binding(0) var<storage,read_write> oit:array<atomic<u32>>;
@group(${OIT_GROUP}) @binding(1) var<uniform> oitParams:OitParams;
@group(${OIT_GROUP}) @binding(3) var<storage,read_write> oitB:array<atomic<u32>>;
// The fragments below this opacity add nothing.
const OIT_OPACITY_THRESHOLD:f32=0.001;
fn oitPut(frag:u32,word:u32,value:u32){
 let i=(frag&0x7fffffffu)+word;
 if((frag&OIT_POOL_BIT)!=0u){atomicStore(&oitB[i],value);}
 else{atomicStore(&oit[i],value);}
}
// Adds to one sum of the spill; the add that wraps the sum past its 32 bits sets the sum's flag, and the sum then reads as the top.
fn oitSpillAdd(header:u32,word:u32,bit:u32,step:u32){
 if(step==0u){return;}
 let old=atomicAdd(&oit[header+word],step);
 if(old+step<old){atomicOr(&oit[header+${OIT_HEADER_SPILL_SAT}u],1u<<bit);}
}
// Sums a fragment into the pixel's spill: no loop, no order.
fn oitSpill(header:u32,f:OitFrag,key:vec2u){
 let l=oitSpillLightFixed(f.colour,key);
 let t=oitSpillTransFixed(f.trans,key);
 oitSpillAdd(header,${OIT_HEADER_SPILL_LIGHT}u,0u,l.x);
 oitSpillAdd(header,${OIT_HEADER_SPILL_LIGHT + 1}u,1u,l.y);
 oitSpillAdd(header,${OIT_HEADER_SPILL_LIGHT + 2}u,2u,l.z);
 oitSpillAdd(header,${OIT_HEADER_SPILL_TRANS}u,3u,t.x);
 oitSpillAdd(header,${OIT_HEADER_SPILL_TRANS + 1}u,4u,t.y);
 oitSpillAdd(header,${OIT_HEADER_SPILL_TRANS + 2}u,5u,t.z);
}
// Puts the fragment of a pixel, with its order key (the primitive's place in the paint order, its triangle's rank), in the pixel's slots or the pool, or sums it into the spill.
fn oitAdd(pixel:vec2u,f:OitFrag,key:vec2u){
 let pix=pixel.y*oitParams.pitch+pixel.x;
 if(pix>=oitParams.pixels){return;}
 let header=oitHeaderAt(pix);
 let arrived=atomicAdd(&oit[header+${OIT_HEADER_COUNT}u],1u);
 if(arrived>=${OIT_LIST_BOUND}u){oitSpill(header,f,key);return;}
 var frag:u32;
 if(arrived<oitParams.samples){frag=oitSlotRef(pix,arrived);}
 else{
  // The count is tested before it is taken: once the pool is spent it stops, at most the nodes plus the invocations in flight, so it never wraps.
  if(atomicLoad(&oit[${OIT_GLOBAL_NODES}])>=oitParams.nodes){oitSpill(header,f,key);return;}
  let node=atomicAdd(&oit[${OIT_GLOBAL_NODES}],1u);
  if(node>=oitParams.nodes){oitSpill(header,f,key);return;}
  frag=oitNodeRef(node+1u);
  oitPut(frag,${OIT_NODE_NEXT}u,atomicExchange(&oit[header+${OIT_HEADER_HEAD}u],node+1u));
 }
 oitPut(frag,${OIT_NODE_DEPTH}u,bitcast<u32>(f.depth));
 oitPut(frag,${OIT_NODE_COLOUR}u,oitPack(f.colour));
 oitPut(frag,${OIT_NODE_TRANS}u,oitPack(saturate(f.trans)));
 oitPut(frag,${OIT_NODE_KEY}u,key.x);
 oitPut(frag,${OIT_NODE_TRI}u,key.y);
}
// The sorted layers' stage: the blend stage's fragment, its light and its transmittance collected, nothing written to the targets. The
// depth stored is the fragment's negated (the depth is reversed: the larger is the nearer), so that the smaller is the nearer.
@fragment fn fsBlendOit(in:VSOut,@builtin(front_facing) front:bool,@builtin(sample_mask) covered:u32)->BlendOut{${shade.entry}
 let o=blendFragment(sceneVsOut(in),front,0.0);
 let alpha=o.color.a;
 let pixel=vec2u(in.position.xy);
 if(covered!=0u&&alpha>OIT_OPACITY_THRESHOLD&&in.position.z>=oitSceneDepth(pixel)){
  var f:OitFrag;
  f.colour=o.color.rgb*alpha;
  f.depth=-in.position.z;
  f.trans=vec3f(1.0-alpha);
  oitAdd(pixel,f,vec2u(in.${ORDER_WORD},in.${WORDS.tri}&${(1 << TRI_CHANNELS_SHIFT) - 1}u));
 }
 return BlendOut(vec4f(0.0),o.request,vec4f(0.0),vec4f(0.0));
}
`,
  )

/**
 * THE PIXEL'S FRAGMENTS IN KEY ORDER, read from the buffers `oit` and `oitB` (words) and the parameters `oitParams` the program declares: a fragment is
 * ordered by the triple (the primitive's place in the paint order, its triangle's rank, its place in the pixel's storage), which no two fragments
 * share, so that the order is total and the result the same whatever the order the fragments reached the buffer in. A pixel keeps at most
 * `OIT_LIST_BOUND` fragments in its list (`OIT_RUN` times `OIT_RUNS`), so the walk is bounded whatever the count that reached the pixel: the
 * fragments are taken in runs of `OIT_RUN`: one walk of the pixel's list keeps, in a heap, the `OIT_RUN` smallest past the last run's, which are sorted in place
 * and inserted in order (`OIT_INSERT_WGSL`); a pixel of at most `OIT_RUN` fragments is walked once, and the cost is the walks (the list times the runs, at most
 * `OIT_RUNS`) plus a logarithm of the run for each fragment kept in a heap. Everything the walk reads is sorted. The spill (the fragments past the
 * bound or the pool's end, summed) is merged behind the last kept sample, as the reference merges every fragment past its samples into its last one: its
 * light seen through the last sample's transmittance, the transmittances multiplied.
 */
export const OIT_WALK_WGSL = wgslBlock(
  'OIT_WALK_WGSL',
  [OIT_INSERT_WGSL, ADDRESS],
  `fn oitWord(frag:u32,word:u32)->u32{
 let i=(frag&0x7fffffffu)+word;
 if((frag&OIT_POOL_BIT)!=0u){return oitB[i];}
 return oit[i];
}
// The reference of a pixel's fragment by its rank: a slot below the samples, past them the pool's node of the rank minus the samples (from 0).
fn oitRefAt(header:u32,slotOrNode:u32)->u32{
 if(slotOrNode<oitParams.samples){return oitSlotRef(oitPixOf(header),slotOrNode);}
 return oitNodeRef(slotOrNode-oitParams.samples+1u);
}
fn oitLoad(frag:u32)->OitFrag{
 var f:OitFrag;
 f.depth=bitcast<f32>(oitWord(frag,${OIT_NODE_DEPTH}u));
 f.colour=unpackLight(oitWord(frag,${OIT_NODE_COLOUR}u));
 f.trans=saturate(unpackLight(oitWord(frag,${OIT_NODE_TRANS}u)));
 return f;
}
// A fragment's rank: its primitive's place in the paint order, its triangle's rank, its place in the storage.
fn oitRankAt(frag:u32,slotOrNode:u32)->vec3u{return vec3u(oitWord(frag,${OIT_NODE_KEY}u),oitWord(frag,${OIT_NODE_TRI}u),slotOrNode);}
fn oitBefore(a:vec3u,b:vec3u)->bool{
 if(a.x!=b.x){return a.x<b.x;}
 if(a.y!=b.y){return a.y<b.y;}
 return a.z<b.z;
}
// The heap of a run, its largest rank at the top.
var<private> oitRun:array<vec3u,${OIT_RUN}>;
fn oitSiftDown(root:u32,n:u32){
 var i=root;
 loop{
  let l=2u*i+1u;
  var big=i;
  if(l<n&&oitBefore(oitRun[big],oitRun[l])){big=l;}
  if(l+1u<n&&oitBefore(oitRun[big],oitRun[l+1u])){big=l+1u;}
  if(big==i){break;}
  let held=oitRun[i];oitRun[i]=oitRun[big];oitRun[big]=held;
  i=big;
 }
}
// Keeps the rank among the run's m smallest (the run grows to its size, then replaces its largest).
fn oitKeep(p:vec3u,m:u32)->u32{
 if(m==${OIT_RUN}u){
  if(oitBefore(p,oitRun[0])){oitRun[0]=p;oitSiftDown(0u,m);}
  return m;
 }
 var c=m;
 oitRun[c]=p;
 while(c>0u){
  let parent=(c-1u)/2u;
  if(!oitBefore(oitRun[parent],oitRun[c])){break;}
  let held=oitRun[c];oitRun[c]=oitRun[parent];oitRun[parent]=held;
  c=parent;
 }
 return m+1u;
}
// The heap of m ranks put in ascending order, in place.
fn oitSortRun(m:u32){
 for(var e=m;e>1u;e--){
  let held=oitRun[0];oitRun[0]=oitRun[e-1u];oitRun[e-1u]=held;
  oitSiftDown(0u,e-1u);
 }
}
// Inserts the fragments of a pixel's list in key order, then merges its spill behind the last kept.
fn oitWalk(header:u32,arrived:u32,samples:u32){
 var last=vec3u(0u);
 var started=false;
 let listed=min(arrived,${OIT_LIST_BOUND}u);
 let inSlots=min(listed,oitParams.samples);
 for(var round=0u;round<${OIT_RUNS}u;round++){
  var m=0u;
  var node=oit[header+${OIT_HEADER_HEAD}u];
  for(var v=0u;v<listed;v++){
   var slotOrNode=v;
   if(v>=inSlots){
    if(node==0u){break;}
    slotOrNode=oitParams.samples+node-1u;
    node=oitWord(oitNodeRef(node),${OIT_NODE_NEXT}u);
   }
   let p=oitRankAt(oitRefAt(header,slotOrNode),slotOrNode);
   if(started&&!oitBefore(last,p)){continue;}
   m=oitKeep(p,m);
  }
  if(m==0u){break;}
  oitSortRun(m);
  for(var k=0u;k<m;k++){oitInsert(oitLoad(oitRefAt(header,oitRun[k].z)),samples,oitParams.threshold);}
  last=oitRun[m-1u];
  started=true;
  if(m<${OIT_RUN}u){break;}
 }
 // The spill: the light of the fragments past the list seen through the last kept sample, that sample's transmittance times theirs.
 let flags=oit[header+${OIT_HEADER_SPILL_SAT}u];
 let light=vec3u(oit[header+${OIT_HEADER_SPILL_LIGHT}u],oit[header+${OIT_HEADER_SPILL_LIGHT + 1}u],oit[header+${OIT_HEADER_SPILL_LIGHT + 2}u]);
 let trans=vec3u(oit[header+${OIT_HEADER_SPILL_TRANS}u],oit[header+${OIT_HEADER_SPILL_TRANS + 1}u],oit[header+${OIT_HEADER_SPILL_TRANS + 2}u]);
 if(oitCount>0u&&(any(light!=vec3u(0u))||any(trans!=vec3u(0u)))){
  var behind:OitFrag;
  behind.colour=oitSpillLightOf(light,flags);
  behind.trans=oitSpillTransOf(trans,flags);
  behind.depth=oitKept[oitCount-1u].depth;
  oitKept[oitCount-1u]=oitMerge(oitKept[oitCount-1u],behind);
 }
}
`,
)

/**
 * THE COMBINATION, one full-screen pass over the translucency target after the layers are collected (`oitPass.ts`): each pixel's fragments
 * put in the paint order of their primitives and inserted one after the other as the reference's multi-layer blending inserts them
 * (`OIT_WALK_WGSL`), whatever the method asked (which only names the debug text). The kept fragments are then composed front to back, the light of each weighed by what the nearer ones let
 * through. The target then holds the light plus what it held multiplied, per channel, by the transmittance, as the reference's combine writes it, its
 * alpha replaced by the mean of the channels of the transmittance. A pixel with no fragment is left as it is. The pixel's header is reset by the
 * pass that finishes the pixel, for the next image; the pixel the debug asks for gets its figures written there.
 * On a device with dual-source blending one draw does it all (`oitCombine`: the light the first source, the transmittance the second, the
 * destination multiplied by it); else two draws share one walk: `oitScale` walks, multiplies the target by the transmittance and leaves the pixel's
 * light and alpha in its first slot (which the walk is done with), and `oitLight`, after it, reads them, adds the light and resets the header — the same result.
 */
const COMBINE_TEXT = `@group(0) @binding(0) var<storage,read_write> oit:array<u32>;
@group(0) @binding(1) var<uniform> oitParams:OitParams;
@group(0) @binding(3) var<storage,read_write> oitB:array<u32>;
var<private> oitSum=vec3f(0.0);
var<private> oitThrough=vec3f(1.0);
var<private> oitPixelIndex=0u;
fn oitPut(frag:u32,word:u32,value:u32){
 let i=(frag&0x7fffffffu)+word;
 if((frag&OIT_POOL_BIT)!=0u){oitB[i]=value;}
 else{oit[i]=value;}
}
// The words the pass read are reset for the next image; the slots and the nodes are valid by the count and the links.
fn oitReset(header:u32){
 for(var i=0u;i<${OIT_HEADER_WORDS}u;i++){oit[header+i]=0u;}
}
// Composes the pixel's kept fragments into oitSum and oitThrough; whether it has any. The pass that ends with the pixel (reset) resets its header; the figures asked are written by the pass that walks.
// The first pixel keeps the largest of the image's passes' counts of nodes asked of the pool: the demand the pool is sized by.
fn oitResolve(position:vec4f,reset:bool)->bool{
 let pix=u32(position.y)*oitParams.pitch+u32(position.x);
 if(pix==0u){oit[${OIT_GLOBAL_DEMAND}]=max(oit[${OIT_GLOBAL_DEMAND}],oit[${OIT_GLOBAL_NODES}]);}
 if(pix>=oitParams.pixels){return false;}
 let samples=min(oitParams.samples,${OIT_MAX_SAMPLES}u);
 let header=oitHeaderAt(pix);
 oitPixelIndex=pix;
 let arrived=oit[header+${OIT_HEADER_COUNT}u];
 if(arrived>0u){
  oitWalk(header,arrived,samples);
  if(reset){oitReset(header);}
 }
 if(pix==oitParams.cursor){
  let at=oitDebugAt();
  oitB[at]=oitCount;
  oitB[at+1u]=arrived;
  for(var i=0u;i<oitCount;i++){
   oitB[at+2u+i*3u]=bitcast<u32>(oitKept[i].depth);
   oitB[at+3u+i*3u]=oitPack(oitKept[i].colour);
   oitB[at+4u+i*3u]=oitPack(oitKept[i].trans);
  }
 }
 for(var i=0u;i<oitCount;i++){
  oitSum+=oitKept[i].colour*oitThrough;
  oitThrough=saturate(oitThrough*oitKept[i].trans);
 }
 return oitCount>0u;
}
fn oitAlpha()->f32{return saturate(dot(oitThrough,vec3f(1.0/3.0)));}
@fragment fn oitScale(@builtin(position) position:vec4f)->@location(0) vec4f{
 if(!oitResolve(position,false)){discard;}
 let at=oitSlotRef(oitPixelIndex,0u);
 oitPut(at,0u,bitcast<u32>(oitSum.r));
 oitPut(at,1u,bitcast<u32>(oitSum.g));
 oitPut(at,2u,bitcast<u32>(oitSum.b));
 oitPut(at,3u,bitcast<u32>(oitAlpha()));
 return vec4f(oitThrough,1.0);
}
@fragment fn oitLight(@builtin(position) position:vec4f)->@location(0) vec4f{
 let pix=u32(position.y)*oitParams.pitch+u32(position.x);
 if(pix>=oitParams.pixels){discard;}
 let header=oitHeaderAt(pix);
 if(oit[header+${OIT_HEADER_COUNT}u]==0u){discard;}
 let at=oitSlotRef(pix,0u);
 let shown=vec4f(bitcast<f32>(oitWord(at,0u)),bitcast<f32>(oitWord(at,1u)),bitcast<f32>(oitWord(at,2u)),bitcast<f32>(oitWord(at,3u)));
 oitReset(header);
 return shown;
}`

const COMBINE_USES = [OIT_WALK_WGSL, FULLSCREEN_VERTEX]

/** The combination on a device without dual-source blending: `oitScale` then `oitLight`. */
export const OIT_COMBINE_WGSL = wgslProgram(COMBINE_TEXT, COMBINE_USES)

/** The combination in one draw on a device granted `dual-source-blending`: a module of its own, as the directive is refused where the feature is not granted. */
export const OIT_COMBINE_DUAL_WGSL = wgslProgram(
  `enable dual_source_blending;${COMBINE_TEXT}
struct OitDual{@location(0) @blend_src(0) light:vec4f,@location(0) @blend_src(1) factor:vec4f,}
@fragment fn oitCombine(@builtin(position) position:vec4f)->OitDual{
 if(!oitResolve(position,true)){discard;}
 return OitDual(vec4f(oitSum,oitAlpha()),vec4f(oitThrough,0.0));
}`,
  COMBINE_USES,
)
