import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { SHADOW_VIEW_WGSL } from './shadowViewWgsl.ts';
import { VSM_CONSTANTS_WGSL, VSM_MASK_MAX_RAYS, VSM_UNIT_PER_CM } from '../../vsm/constants.ts';
import { VSM_UNIFORMS_WGSL } from '../../vsm/uniforms.ts';
import { vsmPoolTexelIndexWgsl } from '../../vsm/resources.ts';
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from '../../vsm/pageTableWgsl.ts';
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  VSM_PROJECTION_SAMPLE_WGSL,
} from '../../vsm/projectionDataWgsl.ts';
import { vsmTransmissionReadWgsl } from '../../vsm/transmissionWgsl.ts';
import {
  VSM_TRACE_RESULT_WGSL,
  VSM_TRACE_COMMON_WGSL,
  VSM_TRACE_DIRECTIONAL_WGSL,
  VSM_TRACE_LIGHT_WGSL,
  VSM_TRACE_LOCAL_WGSL,
  vsmTraceWgsl,
} from '../../vsm/traceWgsl.ts';
import { VSM_BLUE_NOISE_SIZE, VSM_BLUE_NOISE_SLICES } from '../../vsm/blueNoise.ts';
import { PCF_TAPS } from './pcfTaps.ts';
import {
  VSM_MASK_TABLE_BINDING,
  VSM_MASK_TILES_BINDING,
  vsmMaskTableReadWgsl,
} from '../../vsm/projectionMaskTable.ts';
import { VSM_PROJECTION_GROUP_SHIFT } from '../../vsm/projectionWgsl.ts';
import { interleavedGradientWgsl } from '../../math/interleavedGradientWgsl.ts';
import { ALL_SHADOW_KINDS, byShadowKind, type ShadowKinds } from './shadowKinds.ts';

/** Where a pass binds the virtual shadow maps a consumer samples (`vsmShadowFactor`): the page
 *  table, the projection data, the uniforms and the pool's dynamic slice (one part). */
export interface VsmConsumerBindings {
  pageTable: number;
  projectionData: number;
  uniforms: number;
  pool: number;
}
/** The opaque resolve's and the water composite's numbers (the old records', atlas, sampler and
 *  translucent depth). */
export const CONTRACT_VSM_BINDINGS: VsmConsumerBindings = {
  pageTable: 8,
  projectionData: 9,
  uniforms: 10,
  pool: 19,
};

/** A consumer's read of the pool's dynamic slice, at `binding`. */
const vsmPoolReadWgsl = (binding: number) => `
@group(0) @binding(${binding}) var<storage,read> vsmPool0:array<u32>;
${vsmPoolTexelIndexWgsl('vsmPoolTexelIndex', 'vsm.poolRowShift')}
fn vsmPoolLoad(t:vec2u,slice:u32)->u32{
 let i=vsmPoolTexelIndex(t);
 if(i>=arrayLength(&vsmPool0)){return 0u;}
 return vsmPool0[i];
}`;

/** The opaque resolve binds no pool: its opaque shadow is the mask's, and its transmission read
 *  takes a sample's page, never its depth (`vsmTransmissionRead`), so a depth reads 0 there, which
 *  no read takes. Its stage holds the eight storage buffers WebGPU guarantees
 *  (`deferredLayoutEntries`). */
const RESOLVE_POOL_WGSL = `fn vsmPoolLoad(t:vec2u,slice:u32)->u32{return 0u;}`;

/**
 * The plain (untraced) lookup of a virtual shadow map — what forward shading and translucency read
 * (directional or local, one filtered page-table lookup with a coarser-level fallback, optimal
 * slope bias) — at a point `P` of normal `N`, for VSM id `id`. The point is moved along its normal
 * by the normal bias length.
 * The origin shift is the pass's eye (`shadowCamera`), in single precision.
 */
const vsmConsumerWgsl = (
  b: VsmConsumerBindings,
  transmissionBinding: number,
  pool: boolean,
  kinds: ShadowKinds,
) => `
${VSM_CONSTANTS_WGSL}
${VSM_UNIFORMS_WGSL}
${VSM_HANDLE_WGSL}
${VSM_STRUCTS_WGSL}
${VSM_PAGE_ADDRESS_WGSL}
${VSM_PROJECTION_DATA_WGSL}
@group(0) @binding(${b.uniforms}) var<uniform> vsm:VsmUniforms;
@group(0) @binding(${b.pageTable}) var<storage,read> vsmPageTable:array<u32>;
fn vsmPageTableLoad(i:u32)->u32{return vsmPageTable[i];}
@group(0) @binding(${b.projectionData}) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;
${pool ? vsmPoolReadWgsl(b.pool) : RESOLVE_POOL_WGSL}
${VSM_PAGE_LOOKUP_WGSL}
${VSM_PROJECTION_DATA_READ_WGSL}
${VSM_PROJECTION_SAMPLE_WGSL}
${vsmTransmissionReadWgsl(transmissionBinding)}
/** The optimal slope bias's terms: the receiver plane's depth slope per texel of the
 *  sample's level (xy), the bias cap (z) and the level's scale to \`requested\` (w). */
fn vsmConsumerSlope(requested:VsmHandle,sm:VsmMapRead,twPos:vec3f,N:vec3f)->vec4f{
 let pd=vsmProjectionOf(sm.handle);
 let plane=pd.planesToMapUv*vec4f(N,-dot(N,twPos));
 let dim=f32(vsmTexelsAtLevel(sm.mipLevel));
 return vec4f(-plane.xy/plane.z/dim,abs(100.0*${VSM_UNIT_PER_CM}*pd.lightViewToClip[2][2]),f32(1u<<(sm.handle.id-requested.id)));
}
/** The optimal slope bias for a texel \`offset\` texels from the receiver's position. */
fn vsmConsumerSlopeBiasAt(slope:vec4f,offset:vec2f)->f32{return min(2.0*max(0.0,dot(slope.xy,offset)),slope.z)*slope.w;}
fn vsmConsumerSlopeBias(slope:vec4f,sm:VsmMapRead)->f32{
 return vsmConsumerSlopeBiasAt(slope,vec2f(sm.mapTexelXY)+0.5-sm.mapTexelPos);
}
/** 1 lit, 0 shadowed; 1 where no page holds the point (nothing mapped at any level). Sets
 *  \`shadowTransmission\`: what the translucent casters let through (\`vsmTransmissionThrough\`). */
fn vsmShadowFactor(id:u32,directional:bool,P:vec3f,Nin:vec3f)->f32{
 let N=normalize(Nin);
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 let distanceToCamera=length(P-shadowCamera);
 let tangent=max(shadowAngularPixel*shadowViewWidth*0.5,1e-6);
 let fromEye=(P-shadowCamera)+N*max(VSM_NORMAL_OFFSET_FLOOR,vsm.normalBias*distanceToCamera*tangent);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return 1.0;}
  let lh=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(lh);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  let sm=vsmReadClipmap(lh,uvz.xy);
  if(!sm.valid){return 1.0;}
  let slope=vsmConsumerSlope(lh,sm,fromMap,N);
  shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,true);
  return select(1.0,0.0,sm.depth-vsmConsumerSlopeBias(slope,sm)>uvz.z);`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 var uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
 uvz=vec4f(uvz.xyz/uvz.w,uvz.w);
 let sm=vsmReadMap(h,uvz.xy,pd.finestMip);
 if(!sm.valid){return 1.0;}
 let slope=vsmConsumerSlope(h,sm,fromMap,N);
 shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,false);
 return select(1.0,0.0,sm.depth-vsmConsumerSlopeBias(slope,sm)>uvz.z);`,
 )}
}`;

/**
 * Mode 1 of a blended surface's and the water's read (`vsmShadowRead`): sixteen taps a texel apart
 * (`pcfTaps.ts`) around the point read's sample, at the level that sample was read at — the
 * requested one, or the coarser one its page fell back to —, each a bilinear compare of four
 * texels. Their footprints all lie in the 4 × 4 texels around the sample: each of those is read
 * once, against the receiver with its own receiver-plane bias (`vsmConsumerSlopeBiasAt`, from its
 * centre), and weighed by the share of the taps' footprints it holds. A texel off the sample's page
 * reads its own page, translated once per page (`vsmFilterPage`): that level's page where mapped,
 * else the coarser page the table points to, read at the texel holding the centre — as the point
 * read falls back. The translucent casters' transmission is the point read's, at the receiver,
 * once, wherever a texel lets the opaque light through (`vsmShadowFiltered`). The normal and slope
 * biases are the point read's.
 */
const filteredReadWgsl = (kinds: ShadowKinds) => `
const VSM_FILTER_TAPS:array<vec2f,${PCF_TAPS.length}>=array<vec2f,${PCF_TAPS.length}>(${PCF_TAPS.map(([x, y]) => `vec2f(${x},${y})`).join(',')});
/** A page of the filtered read's level, translated once for the block texels in it: none (\`kind\`
 *  0), that level's own (1), or the coarser page its entry points to (2), whose texel holding a
 *  texel's centre \`c\` is \`c·texelScale + texelBias\`, kept in [\`first\`, \`first\` + 127]; the
 *  requested level's depth from its own (\`(d − depthBias) · depthInverse\`, the level scale's exact inverse). */
struct VsmFilterPage{kind:u32,physical:vec2u,first:vec2u,texelScale:f32,texelBias:vec2f,depthInverse:f32,depthBias:f32,}
/** The page the sample \`sm\` was read in, of a map requested at \`requested\`. */
fn vsmFilterOwnPage(requested:VsmHandle,sm:VsmMapRead)->VsmFilterPage{
 var depthInverse=1.0;var depthBias=0.0;
 let offset=i32(sm.handle.id)-i32(requested.id);
 if(offset>0){let t=vsmLevelToLevelOf(requested,offset);depthInverse=t.depthInverse;depthBias=t.bias.z;}
 return VsmFilterPage(1u,sm.poolTexel>>vec2u(VSM_LOG2_PAGE),(sm.mapTexelXY>>vec2u(VSM_LOG2_PAGE))*VSM_PAGE_TEXELS,1.0,vec2f(0.0),depthInverse,depthBias);
}
/** Page \`page\` of the level \`sm\` was read at, through the page table. */
fn vsmFilterPage(requested:VsmHandle,sm:VsmMapRead,page:vec2u,clipmap:bool)->VsmFilterPage{
 let e=vsmTableEntryAtOffset(vsmTableEntryOf(sm.handle,sm.mipLevel,page));
 if(!e.anyLevelMapped){return VsmFilterPage(0u,vec2u(0u),vec2u(0u),1.0,vec2f(0.0),1.0,0.0);}
 if(!clipmap){
  // A lamp's coarser mip has its depth's scale; the finer entry holds that mip's page.
  return VsmFilterPage(select(2u,1u,e.thisLevelMapped),e.physicalAddress,(page>>vec2u(e.coarserLevels))*VSM_PAGE_TEXELS,1.0/f32(1u<<e.coarserLevels),vec2f(0.0),1.0,0.0);
 }
 let own=i32(sm.handle.id)-i32(requested.id);
 if(e.thisLevelMapped){
  var depthInverse=1.0;var depthBias=0.0;
  if(own>0){let t=vsmLevelToLevelOf(requested,own);depthInverse=t.depthInverse;depthBias=t.bias.z;}
  return VsmFilterPage(1u,e.physicalAddress,page*VSM_PAGE_TEXELS,1.0,vec2f(0.0),depthInverse,depthBias);
 }
 // A clipmap's coarser level is a map of its own: its page, then its entry.
 let coarsePage=vsmCoarserLevelPage(page,sm.handle,e.coarserLevels);
 let c=vsmTableEntryAtOffset(vsmTableEntryOf(vsmHandleOffset(sm.handle,i32(e.coarserLevels)),0u,coarsePage));
 if(!c.thisLevelMapped){return VsmFilterPage(0u,vec2u(0u),vec2u(0u),1.0,vec2f(0.0),1.0,0.0);}
 let texel=vsmLevelToLevelOf(sm.handle,i32(e.coarserLevels));
 let depth=vsmLevelToLevelOf(requested,own+i32(e.coarserLevels));
 return VsmFilterPage(2u,c.physicalAddress,coarsePage*VSM_PAGE_TEXELS,texel.scale,texel.bias.xy*f32(VSM_LEVEL0_TEXELS),depth.depthInverse,depth.bias.z);
}
fn vsmFilterPageOf(requested:VsmHandle,sm:VsmMapRead,page:vec2u,home:vec2u,own:VsmFilterPage,clipmap:bool)->VsmFilterPage{
 if(all(page==home)){return own;}
 return vsmFilterPage(requested,sm,page,clipmap);
}
/** Where block texel (\`x\`, \`y\`) of the read level is read in \`page\`: its physical texel, and its
 *  centre in texels of the read level — a coarser page's own texel's, which its bias measures from. */
struct VsmFilterTexel{physical:vec2u,centre:vec2f,}
fn vsmFilterTexelAt(page:VsmFilterPage,x:u32,y:u32)->VsmFilterTexel{
 var at=vec2u(x,y);var centre=vec2f(at)+0.5;
 if(page.kind==2u){
  at=clamp(vec2u(centre*page.texelScale+page.texelBias),page.first,page.first+vec2u(VSM_PAGE_TEXEL_MASK));
  centre=(vec2f(at)+0.5-page.texelBias)/page.texelScale;
 }
 return VsmFilterTexel(page.physical*VSM_PAGE_TEXELS+(at&vec2u(VSM_PAGE_TEXEL_MASK)),centre);
}
/** The filtered read around sample \`sm\` of a map requested at \`requested\`, for a receiver at depth
 *  \`z\`, receiver plane \`slope\` (\`vsmConsumerSlope\`): the share of the light the opaque casters
 *  let through. The texels are compared first, a bit a texel: a block all in shadow reads 0, one
 *  all lit 1, exactly, and only the others weigh the taps. */
fn vsmFilterTaps(requested:VsmHandle,sm:VsmMapRead,z:f32,slope:vec4f,clipmap:bool)->f32{
 let p=sm.mapTexelPos;
 // The block's first texel: each tap's lower texel lies one or two past it.
 let origin=vec2i(floor(p-0.5))-vec2i(1);
 // The block kept on the level's texels (a lamp face's edge), and the one or two pages it spans on
 // each axis. A clamped texel only moves up, so the upper page starts at the split on that axis.
 let last=i32(vsmTexelsAtLevel(sm.mipLevel))-1;
 let pageLo=vec2u(clamp(origin,vec2i(0),vec2i(last)))>>vec2u(VSM_LOG2_PAGE);
 let pageHi=vec2u(clamp(origin+vec2i(3),vec2i(0),vec2i(last)))>>vec2u(VSM_LOG2_PAGE);
 let span=pageHi-pageLo+vec2u(1u);
 let split=select(vec2i(4),clamp(vec2i(pageHi<<vec2u(VSM_LOG2_PAGE))-origin,vec2i(0),vec2i(4)),pageHi!=pageLo);
 let home=sm.mapTexelXY>>vec2u(VSM_LOG2_PAGE);
 let own=vsmFilterOwnPage(requested,sm);
 // Each texel's opaque compare, against the receiver with that texel's own bias. A texel no level
 // holds lights the receiver, as an unmapped point does. A depth scale is a power of two: its
 // inverse multiplies exactly.
 var shadowed=0u;
 if(span.x*span.y==1u&&all(pageLo==home)){
  // The whole block in the sample's own page, as nearly every pixel: no page to choose.
  let base=own.physical*VSM_PAGE_TEXELS;let inverse=own.depthInverse;
  for(var j=0;j<4;j++){
   let y=u32(clamp(origin.y+j,0,last));
   for(var i=0;i<4;i++){
    let at=vec2u(u32(clamp(origin.x+i,0,last)),y);
    if((vsmPoolDepth(base+(at&vec2u(VSM_PAGE_TEXEL_MASK)))-own.depthBias)*inverse-vsmConsumerSlopeBiasAt(slope,vec2f(at)+0.5-p)>z){shadowed=shadowed|(1u<<u32(4*j+i));}
   }
  }
 }else{
  // The two to four pages the block spans, one at a time: each translated once, its texels read in it.
  for(var k=0u;k<span.x*span.y;k++){
   let s=vec2u(k%span.x,k/span.x);
   let rec=vsmFilterPageOf(requested,sm,pageLo+s,home,own,clipmap);
   if(rec.kind==0u){continue;}
   let lo=select(vec2i(0),split,s==vec2u(1u));let hi=select(split,vec2i(4),s==vec2u(1u));
   let inverse=rec.depthInverse;
   for(var j=lo.y;j<hi.y;j++){
    let y=u32(clamp(origin.y+j,0,last));
    for(var i=lo.x;i<hi.x;i++){
     let t=vsmFilterTexelAt(rec,u32(clamp(origin.x+i,0,last)),y);
     if((vsmPoolDepth(t.physical)-rec.depthBias)*inverse-vsmConsumerSlopeBiasAt(slope,t.centre-p)>z){shadowed=shadowed|(1u<<u32(4*j+i));}
    }
   }
  }
 }
 if(shadowed==0xFFFFu){return 0.0;}
 if(shadowed==0u){return 1.0;}
 // Each block texel's weight summed over the taps, a row of four a vector. A tap's bilinear weight
 // of column k is the tent max(0, 1 − |q − k|), written with its two differences: q − (k − 1) is the
 // exact fraction f on the upper column, (k + 1) − q rounds the same real 1 − f once on the lower,
 // and every other column clamps to +0 — the weights of floor and fraction, bit for bit.
 let base=p-0.5-vec2f(origin);
 let below=vec4f(-1.0,0.0,1.0,2.0);let above=vec4f(1.0,2.0,3.0,4.0);
 var w0=vec4f(0.0);var w1=vec4f(0.0);var w2=vec4f(0.0);var w3=vec4f(0.0);
 for(var tap=0u;tap<${PCF_TAPS.length}u;tap++){
  let q=base+VSM_FILTER_TAPS[tap];
  let wx=saturate(min(q.x-below,above-q.x));
  let wy=saturate(min(q.y-below,above-q.y));
  w0+=wy.x*wx;w1+=wy.y*wx;w2+=wy.z*wx;w3+=wy.w*wx;
 }
 var total=0.0;var lit=0.0;
 for(var j=0;j<4;j++){
  let weights=select(select(w0,w1,j==1),select(w2,w3,j==3),j>1);
  for(var i=0;i<4;i++){
   let w=weights[i];
   total+=w;
   if((shadowed&(1u<<u32(4*j+i)))==0u){lit+=w;}
  }
 }
 return lit/total;
}
/** The filtered read at \`P\`, normal \`N\`: the point read's level and biases, then the
 *  taps. The point read (\`vsmShadowFactor\`) is restated, not shared: it stays, to the byte, the
 *  read of mode 0 and of the opaque resolve's transmission. */
fn vsmShadowFiltered(id:u32,directional:bool,P:vec3f,Nin:vec3f)->f32{
 let N=normalize(Nin);
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 let distanceToCamera=length(P-shadowCamera);
 let tangent=max(shadowAngularPixel*shadowViewWidth*0.5,1e-6);
 let fromEye=(P-shadowCamera)+N*max(VSM_NORMAL_OFFSET_FLOOR,vsm.normalBias*distanceToCamera*tangent);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return 1.0;}
  let lh=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(lh);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  let sm=vsmReadClipmap(lh,uvz.xy);
  if(!sm.valid){return 1.0;}
  let lit=vsmFilterTaps(lh,sm,uvz.z,vsmConsumerSlope(lh,sm,fromMap,N),true);
  if(lit>0.0){shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,true);}
  return lit;`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 var uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
 uvz=vec4f(uvz.xyz/uvz.w,uvz.w);
 let sm=vsmReadMap(h,uvz.xy,pd.finestMip);
 if(!sm.valid){return 1.0;}
 let lit=vsmFilterTaps(h,sm,uvz.z,vsmConsumerSlope(h,sm,fromMap,N),false);
 if(lit>0.0){shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,false);}
 return lit;`,
 )}
}`;

/** The traced read's ray, the sun's or the local light's (`byShadowKind`'s branches, here a block). */
const TRACED_SUN_WGSL = `  let source=VsmProjectionLight(vec3f(0.0),0.0,-light.directionCone.xyz,sin(light.shape.x),vec2f(-2.0,1.0),i32(id),0u);
  traced=vsmTraceSun(i32(id),source,pixel,fromEye,start,noise,N,true,true);`;
const TRACED_LOCAL_WGSL = `  let spot=abs(light.params.x-KIND_SPOT)<0.5;
  let source=VsmProjectionLight(light.positionRange.xyz-shadowCamera,0.0,-light.directionCone.xyz,light.shape.x,vec2f(select(-2.0,light.directionCone.w,spot),1.0),i32(id),0u);
  traced=vsmTraceLocal(i32(id),source,pixel,depth,fromEye,start,noise,N,true,true);`;
const tracedKindWgsl = (kinds: ShadowKinds) =>
  kinds.sun && kinds.local
    ? `if(isSun(light)){\n${TRACED_SUN_WGSL}\n }else{\n${TRACED_LOCAL_WGSL}\n }`
    : `{\n${kinds.sun ? TRACED_SUN_WGSL : TRACED_LOCAL_WGSL}\n }`;

/**
 * Mode 2 of the same read: the opaque projection's rays (`vsmTraceWgsl`, every ray traced: a
 * fragment has no wave to stop them early) at its ray counts, from the receiver itself — no normal
 * offset — and starting a share of the view's height at the pixel's depth along the ray
 * (`screenRayShare`, `viewTanHalfFovY`), the result moved by up to a thirtieth where it is a
 * penumbra, against the banding of the ray count. On the four bindings the read already has: the
 * view the traces read is the pass's own pixel — its footprint gives the depth it measured at and
 * half a pixel there —, and the noise is interleaved gradient noise rather than the projection's
 * blue-noise texture, which the blend stage has no binding for. The translucent casters'
 * transmission is the point read's, as the opaque resolve takes it beside its traced mask.
 */
const tracedReadWgsl = (kinds: ShadowKinds) => `
${VSM_TRACE_LIGHT_WGSL}
/** The view fields the traces read (\`vsmView\`), filled from the pixel by \`vsmShadowTraced\`. */
struct VsmPixelView{shiftedToView:mat4x4f,viewToClip:mat4x4f,originShiftHigh:vec3f,frameIndex:u32,originShiftLow:vec3f,viewPixels:vec4f,}
var<private> vsmView:VsmPixelView;
/** Interleaved gradient noise at a pixel position, in [0, 1): the fraction of a linear form of the
 *  pixel, folded again by a large factor, so that neighbouring pixels take well-spread values. */
fn vsmPixelNoise(p:vec2f)->f32{return ${interleavedGradientWgsl('p')};}
/** The tile the rays' noise repeats over: the blue noise's size and slices. */
const VSM_NOISE_TILE=vec3u(${VSM_BLUE_NOISE_SIZE}u,${VSM_BLUE_NOISE_SIZE}u,${VSM_BLUE_NOISE_SLICES}u);
/** The rays' random pairs at a pixel and frame, offset per ray over the projection's noise tile.
 *  Declared, without derivation, here and in \`vsmShadowTraced\`: the per-frame shift of the pixel
 *  noise (32.665, 11.815) and the shifts that set the pair's second value (47, 17) and the dither's
 *  noise (13, 71) apart from the first; moving any moves this read's noise pattern. */
fn vsmNoiseTwo(pixelAt:vec2u,frameIndex:u32)->vec2f{
 let p=vec2f(pixelAt)+f32(frameIndex%VSM_NOISE_TILE.z)*vec2f(32.665,11.815);
 return vec2f(vsmPixelNoise(p),vsmPixelNoise(p+vec2f(47.0,17.0)));
}
${VSM_TRACE_COMMON_WGSL}
${VSM_TRACE_DIRECTIONAL_WGSL}
${VSM_TRACE_LOCAL_WGSL}
${VSM_TRACE_RESULT_WGSL}
${vsmTraceWgsl(false)}
fn vsmShadowTraced(id:u32,light:DirectLight,P:vec3f,Nin:vec3f)->f32{
 let N=normalize(Nin);
 let angular=max(shadowAngularPixel,1e-20);
 let depth=shadowFootprint/angular;
 let frame=vsm.frameStamp;
 vsmView.shiftedToView=mat4x4f(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(0.0,0.0,0.0,1.0));
 // A view one unit wide whose half pixel at depth d is d·angular/2: the pass's own.
 vsmView.viewToClip=mat4x4f(vec4f(2.0/angular,0.0,0.0,0.0),vec4f(0.0,2.0/angular,0.0,0.0),vec4f(0.0,0.0,0.0,1.0),vec4f(0.0));
 vsmView.viewPixels=vec4f(1.0);
 vsmView.originShiftHigh=-shadowCamera;vsmView.originShiftLow=vec3f(0.0);
 vsmView.frameIndex=frame;
 let pixel=vec2u(shadowPixel);
 let noise=vsmPixelNoise(shadowPixel+f32(frame&7u)*vec2f(32.665,11.815));
 let fromEye=P-shadowCamera;
 let start=vsm.screenRayShare*vsm.viewTanHalfFovY*depth;
 var traced:VsmTraceResult;
 ${tracedKindWgsl(kinds)}
 var shade=traced.shadowFactor;
 // A penumbra's shade (strictly between 0 and 1: k of R rays) moves by up to half the finest step a
 // shade takes, one ray of the most a light traces (\`VSM_MASK_MAX_RAYS\`).
 if(shade>0.0&&shade<1.0){shade=saturate(shade+(vsmPixelNoise(shadowPixel+vec2f(13.0,71.0)+f32(frame%VSM_NOISE_TILE.z)*vec2f(32.665,11.815))-0.5)/${VSM_MASK_MAX_RAYS}.0);}
 if(shade>0.0){_=vsmShadowFactor(id,isSun(light),P,Nin);}
 return shade;
}`;

/**
 * The read of a blended surface and of the water (`vsmShadowRead`), on the word
 * `translucentShadowFilter` of the shadow maps' uniforms (`LIGHT_SETTINGS.translucentShadowFilter`):
 * 0 the point read (`vsmShadowFactor`), 1 the filtered taps, else the traced rays where `traced`
 * compiled them in, the filtered taps where not. Between the point read and the taps the word
 * switches at no recompile. The traces are a variant of the program, behind a read-only setting:
 * compiled into every blend and water program, their code alone slowed the full-screen water by 0.3 ms with the word at 0
 * (a-world-of-blocks, 3456 × 2234). Needs the consumer read (`vsmConsumerWgsl`) and the light code.
 */
const vsmTranslucentReadWgsl = (traced: boolean, kinds: ShadowKinds) => `${filteredReadWgsl(kinds)}
${traced ? tracedReadWgsl(kinds) : ''}
fn vsmShadowRead(id:u32,light:DirectLight,P:vec3f,N:vec3f)->f32{
 let mode=vsm.translucentShadowFilter;
 if(mode==0u){return vsmShadowFactor(id,isSun(light),P,N);}${
   traced
     ? `
 if(mode==2u){return vsmShadowTraced(id,light,P,N);}`
     : ''
 }
 return vsmShadowFiltered(id,isSun(light),P,N);
}`;

/**
 * The shadow read of every lit surface since the virtual shadow maps (`../../vsm/`).
 * A shadowed light's `params.y` is `firstVsmId · 64 + channel`, −1 without a shadow
 * (`encodeVsm.ts`). The opaque resolve reads the frame's traced shadow mask
 * (`encodeVirtualShadowProjection`) at its own pixel (`vsmMaskPixel`, set by its shadow setup),
 * the light's channel, and the point read's lookup (`vsmTransmissionRead`) for the translucent
 * casters' transmission alone, whatever the mode. The blend and water passes take the read the uniform word
 * `translucentShadowFilter` picks (`vsmShadowRead`): the point read (0), the filtered taps (1, the
 * default) or, in a program built with \`traced\` (the setting at 2), the traced rays (2). A
 * reflection reads the lit image, never a shadow map.
 *
 * The resolve reads a shadow only in a cell its shadow setup set the mask pixel of
 * (`cellShadowed`, `shadowSetup`): a cell whose list holds a light with a shadow slot, or — no room
 * for its list — that walks every light, where a light of no list of the cell gives its points
 * exactly zero before any shadow read (`declaredLight`, `incidence.w`), as the lists rest on.
 *
 * `resolveTransmission` is the opaque resolve's binding of the translucent casters' transmission
 * (`VSM_TRANSMISSION_RESOLVE_BINDING`), null in a blend or water pass; `maskBinding` the resolve's
 * mask array, and in the other passes, which declare no mask, their transmission. The names the
 * passes write (footprint, receiver offset and plane, view) are kept, so their bodies need no change.
 */
export const directShadowWgsl = (
  resolveTransmission: number | null,
  maskBinding: number,
  vsmBindings: VsmConsumerBindings = CONTRACT_VSM_BINDINGS,
  traced = LIGHT_SETTINGS.translucentShadowFilter === 2,
  kinds: ShadowKinds = ALL_SHADOW_KINDS,
) => `
var<private> shadowFootprint:f32=0.0;
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
var<private> shadowReceiverPlane:vec3f=vec3f(0.0);
var<private> shadowTransmission:vec3f=vec3f(1.0);
${SHADOW_VIEW_WGSL}
fn shadowBiasNormal(n:vec3f,g:vec3f)->vec3f{
 if(dot(g,g)==0.0){return n;}
 return select(g,-g,dot(g,n)<0.0);
}
${vsmConsumerWgsl(vsmBindings, resolveTransmission ?? maskBinding, resolveTransmission === null, kinds)}
${resolveTransmission === null ? vsmTranslucentReadWgsl(traced, kinds) : vsmMaskWgsl(maskBinding, kinds)}
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,taps:bool)->f32{
 shadowTransmission=vec3f(1.0);
 if(slice<0){return 1.0;}
 if(!taps){return 0.0;}${
   resolveTransmission === null
     ? `
 return vsmShadowRead(u32(slice)>>6u,light,P,N);`
     : `
 let mask=vsmMaskFactor(u32(slice)&63u);
 // The traced mask is opaque only: the translucent casters' colour from the page-table lookup.
 if(mask>0.0&&vsmTranslucentCasters()){vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}
 return mask;`
 }
}`;

const vsmMaskWgsl = (binding: number, kinds: ShadowKinds) => `
@group(0) @binding(${binding}) var vsmShadowMask:texture_2d_array<u32>;
@group(0) @binding(${VSM_MASK_TILES_BINDING}) var vsmShadowMaskTiles:texture_2d<u32>;
${vsmMaskTableReadWgsl(VSM_MASK_TABLE_BINDING)}
/** The resolve's pixel: the mask is read there; (−1, −1) in a pass that reads no mask. */
var<private> vsmMaskPixel:vec2i=vec2i(-1);
/** The layer last loaded at \`vsmMaskPixel\` and its word: every light of a layer shares one load
 *  (\`vsmMaskFactor\`). \`vsmMaskAt\` drops it. */
var<private> vsmMaskLayer:u32=0xffffffffu;
var<private> vsmMaskWord:u32=0u;
/** The layers the projection stored in the pixel's tile, bit L for layer L (its tile word,
 *  \`vsm/projectionWgsl.ts\`): those holding a light it traced there, each a layer of the mask; every
 *  lane of another is 0. None before \`vsmMaskAt\`; \`VSM_MASK_TILE_UNREAD\` after it, until the
 *  pixel's first light that reads the mask loads it (\`vsmMaskFactor\`). */
var<private> vsmMaskTile:u32=0u;
/** No tile word: its sixteen layers' bits never set the high ones. */
const VSM_MASK_TILE_UNREAD:u32=0xffffffffu;
/** The pixel the mask is read at (\`shadowSetup\`): its tile's word is loaded when a light reads it. */
fn vsmMaskAt(coord:vec2i){
 vsmMaskPixel=coord;vsmMaskLayer=0xffffffffu;vsmMaskTile=VSM_MASK_TILE_UNREAD;
}
/** Whether the frame holds translucent casters' transmission: the only read of the resolve that
 *  still takes the receiver (\`shadowReceiver\`); the opaque shadow is the mask's, whose
 *  projection placed each pixel on its receiver already (\`vsm/projectionWgsl.ts\`). */
fn vsmTranslucentCasters()->bool{return textureDimensions(vsmTransmissionMemory).x>1u;}
/** The translucent casters' transmission at \`P\` alone, into \`shadowTransmission\`: the point read
 *  (\`vsmShadowFactor\`) restated to its sample, without its opaque compare — the mask holds the
 *  opaque shadow —, read only where the sample's physical page holds a translucent slice:
 *  elsewhere all the light passes, as \`shadowFactor\` set it. The same terms in the same order:
 *  the same colour, bit for bit, at the lookup's cost alone on the pages no pane covers. */
fn vsmTransmissionRead(id:u32,directional:bool,P:vec3f,Nin:vec3f){
 let N=normalize(Nin);
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 let distanceToCamera=length(P-shadowCamera);
 let tangent=max(shadowAngularPixel*shadowViewWidth*0.5,1e-6);
 let fromEye=(P-shadowCamera)+N*max(VSM_NORMAL_OFFSET_FLOOR,vsm.normalBias*distanceToCamera*tangent);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return;}
  let lh=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(lh);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  let sm=vsmReadClipmap(lh,uvz.xy);
  if(!vsmTransmissionPaned(sm)){return;}
  shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,true);
  return;`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 var uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
 uvz=vec4f(uvz.xyz/uvz.w,uvz.w);
 let sm=vsmReadMap(h,uvz.xy,pd.finestMip);
 if(!vsmTransmissionPaned(sm)){return;}
 shadowTransmission=vsmTransmissionThrough(sm,fromMap,fromEye,shadowCamera,false);`,
 )}
}
/** Light \`channel\`'s factor: its 8-bit lane of layer channel / 4 (\`vsmMaskCode\`), decoded — 1, the
 *  decode of a lane 0, where its tile stored no such layer, which is then not read. The layer's
 *  word is loaded once for the pixel, whatever the number of lights it holds. */
fn vsmMaskFactor(channel:u32)->f32{
 if(vsmMaskTile==VSM_MASK_TILE_UNREAD){
  vsmMaskTile=textureLoad(vsmShadowMaskTiles,vsmMaskPixel>>vec2u(${VSM_PROJECTION_GROUP_SHIFT}u),0).r;
 }
 let layer=channel>>2u;
 if((vsmMaskTile&(1u<<layer))==0u){return 1.0;}
 if(layer!=vsmMaskLayer){
  vsmMaskWord=textureLoad(vsmShadowMask,vsmMaskPixel,layer,0).r;
  vsmMaskLayer=layer;
 }
 return vsmMaskDecode((vsmMaskWord>>(8u*(channel%4u)))&255u);
}`;
