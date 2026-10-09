import { SHADOW_VIEW_WGSL } from './shadowViewWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_UNIT_PER_CM } from '../../vsm/constants.ts'
import { VSM_UNIFORMS_WGSL } from '../../vsm/uniforms.ts'
import { vsmPoolTexelIndexWgsl } from '../../vsm/resources.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from '../../vsm/pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmProjectionSampleWgsl,
} from '../../vsm/projectionDataWgsl.ts'
import { vsmTransmissionReadWgsl } from '../../vsm/transmissionWgsl.ts'
import { PCF_TAPS } from './pcfTaps.ts'
import { VSM_MASK_TILES_BINDING, VSM_MASK_TABLE_READ_WGSL } from '../../vsm/projectionMaskTable.ts'
import { VSM_PROJECTION_GROUP_SHIFT } from '../../vsm/projectionWgsl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { byteOf, pow2FromExponent } from '../../../../math/src/wgsl/integer.ts'
import {
  ALL_SHADOW_KINDS,
  byShadowKind,
  shadowKindsLabel,
  type ShadowKinds,
} from './shadowKinds.ts'

/** Where a pass binds the virtual shadow maps a consumer samples (`vsmLocate`): the page
 *  table, the projection data, the uniforms and the pool's dynamic slice (one part). */
export interface VsmConsumerBindings {
  pageTable: number
  projectionData: number
  uniforms: number
  pool: number
}
/** The opaque resolve's and the water composite's numbers (the records', atlas, sampler and
 *  translucent depth). */
export const CONTRACT_VSM_BINDINGS: VsmConsumerBindings = {
  pageTable: 8,
  projectionData: 9,
  uniforms: 10,
  pool: 19,
}
/** The bindings as a block name reads them, in their declared order. */
export const vsmBindingsLabel = (b: VsmConsumerBindings) =>
  `${b.pageTable}, ${b.projectionData}, ${b.uniforms}, ${b.pool}`

/** A consumer's read of the pool's dynamic slice, at `binding`: its `vsmPoolLoad`, which the
 *  projection sample calls (`vsmProjectionSampleWgsl`). */
const vsmPoolRead = (binding: number) =>
  wgslFn(
    'vsmPoolLoad',
    [
      wgslBlock(
        `vsmPool0(${binding})`,
        [],
        `@group(0) @binding(${binding}) var<storage,read> vsmPool0:array<u32>;`,
      ),
      vsmPoolTexelIndexWgsl('vsmPoolTexelIndex', 'vsm.poolRowShift'),
    ],
    `fn vsmPoolLoad(t:vec2u,slice:u32)->u32{
 let i=vsmPoolTexelIndex(t);
 if(i>=arrayLength(&vsmPool0)){return 0u;}
 return vsmPool0[i];
}`,
  )

/** The opaque resolve binds no pool: its opaque shadow is the mask's, and its transmission read
 *  takes a sample's page, never its depth (`vsmTransmissionRead`), so a depth reads 0 there, which
 *  no read takes. Its stage holds the eight storage buffers WebGPU guarantees
 *  (`deferredLayoutEntries`). */
const RESOLVE_POOL = wgslFn('vsmPoolLoad', [], 'fn vsmPoolLoad(t:vec2u,slice:u32)->u32{return 0u;}')

/**
 * Where a point is read in a virtual shadow map (`vsmLocate`) — directional or local, one page-table
 * lookup with a coarser-level fallback — for VSM id `id`: what the blended surfaces' and the water's
 * filtered read and the opaque resolve's transmission read start from, at a point `P` of unit
 * normal `N` moved along it by the normal bias length (`vsmReceiverFromEye`). The origin shift is
 * the pass's eye (`shadowCamera`), in single precision.
 */
const vsmConsumerWgsl = (
  b: VsmConsumerBindings,
  { transmission, pool, kinds }: { transmission: number; pool: boolean; kinds: ShadowKinds },
) =>
  wgslBlock(
    `vsmConsumerWgsl(${vsmBindingsLabel(b)}, ${transmission}, ${pool}, ${shadowKindsLabel(kinds)})`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_UNIFORMS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_STRUCTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      vsmProjectionSampleWgsl(pool ? vsmPoolRead(b.pool) : RESOLVE_POOL),
      vsmTransmissionReadWgsl(transmission),
      perspectiveDivide,
    ],
    `
@group(0) @binding(${b.uniforms}) var<uniform> vsm:VsmUniforms;
@group(0) @binding(${b.pageTable}) var<storage,read> vsmPageTable:array<u32>;
fn vsmPageTableLoad(i:u32)->u32{return vsmPageTable[i];}
@group(0) @binding(${b.projectionData}) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;
/** The receiver \`P\` from the eye, pushed along its normal \`N\` by the normal bias, which grows with
 *  the distance and the pixel's angular size. */
fn vsmReceiverFromEye(P:vec3f,N:vec3f)->vec3f{
 let distanceToCamera=length(P-shadowCamera);
 let tangent=max(shadowAngularPixel*shadowViewWidth*0.5,1e-6);
 return (P-shadowCamera)+N*max(VSM_NORMAL_OFFSET_FLOOR,vsm.normalBias*distanceToCamera*tangent);
}
/** Where a receiver \`fromEye\` (\`vsmReceiverFromEye\`) is read in map \`id\`: its sample \`sm\` —
 *  invalid where no page holds the point, nothing mapped at any level —; the level \`requested\`,
 *  a sun's clipmap level (\`clipmap\`), whose sample may fall back to a coarser one (\`sm.handle\`),
 *  or a local light's map; the receiver in the map's shifted frame and its depth there. */
struct VsmLocated{sm:VsmMapRead,requested:VsmHandle,clipmap:bool,fromMap:vec3f,depth:f32,}
fn vsmLocate(id:u32,directional:bool,fromEye:vec3f)->VsmLocated{
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return VsmLocated(vsmEmptyRead(),h,true,vec3f(0.0),0.0);}
  let requested=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(requested);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  return VsmLocated(vsmReadClipmap(requested,uvz.xy),requested,true,fromMap,uvz.z);`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 let uvz=perspectiveDivide(pd.shiftedToMapUv*vec4f(fromMap,1.0));
 return VsmLocated(vsmReadMap(h,uvz.xy,pd.finestMip),h,false,fromMap,uvz.z);`,
 )}
}`,
  )

/**
 * The read of a blended surface and of the water (`vsmShadowRead`): sixteen taps a texel apart
 * (`pcfTaps.ts`) around the located sample (`vsmLocate`), at the level that sample was read at —
 * the requested one, or the coarser one its page fell back to —, each a bilinear compare of four
 * texels. Their footprints all lie in the 4 × 4 texels around the sample: each of those is read
 * once, against the receiver with its own receiver-plane bias (`vsmConsumerSlopeBiasAt`, from its
 * centre), and weighed by the share of the taps' footprints it holds. A texel off the sample's page
 * reads its own page, translated once per page (`vsmFilterPage`): that level's page where mapped,
 * else the coarser page the table points to, read at the texel holding the centre — as the sample
 * falls back. The translucent casters' transmission is the sample's, at the receiver, once,
 * wherever a texel lets the opaque light through. Needs the consumer read (`vsmConsumerWgsl`) and
 * the light code. Each kind of map `kinds` holds has its own taps (`vsmFilterKindWgsl`), the one a
 * light reads chosen once, before them, as `byShadowKind` chooses its located read.
 */
const vsmShadowReadWgsl = (kinds: ShadowKinds) =>
  wgslBlock(
    `vsmShadowReadWgsl(${shadowKindsLabel(kinds)})`,
    kinds.local ? [pow2FromExponent] : [],
    `
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
${kinds.sun ? vsmFilterKindWgsl('Sun') : ''}${kinds.local ? vsmFilterKindWgsl('Local') : ''}
/** Light \`light\`'s share at \`P\`, normal \`N\`, of map \`id\`: the located sample's taps; 1 where
 *  no page holds the point. */
fn vsmShadowRead(id:u32,light:DirectLight,P:vec3f,Nin:vec3f)->f32{
 let N=normalize(Nin);
 let fromEye=vsmReceiverFromEye(P,N);
 let directional=isSun(light);
 let at=vsmLocate(id,directional,fromEye);
 if(!at.sm.valid){return 1.0;}
 let slope=vsmConsumerSlope(at.requested,at.sm,at.fromMap,N);
 ${byShadowKind(
   kinds,
   '  return vsmShadowLit(at,fromEye,vsmFilterTapsSun(at.requested,at.sm,at.depth,slope));',
   ' return vsmShadowLit(at,fromEye,vsmFilterTapsLocal(at.requested,at.sm,at.depth,slope));',
 )}
}
/** The share \`lit\` the taps give the located read \`at\`, with its translucent casters'
 *  transmission wherever light passes. */
fn vsmShadowLit(at:VsmLocated,fromEye:vec3f,lit:f32)->f32{
 if(lit>0.0){shadowTransmission=vsmTransmissionThrough(at.sm,at.fromMap,fromEye,shadowCamera,at.clipmap);}
 return lit;
}`,
  )

/** A clipmap level's page off the sample's (\`vsmFilterPage\`): its own where mapped, else the
 *  coarser level's. */
const CLIPMAP_PAGE = ` let own=i32(sm.handle.id)-i32(requested.id);
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
 return VsmFilterPage(2u,c.physicalAddress,coarsePage*VSM_PAGE_TEXELS,texel.scale,texel.bias.xy*f32(VSM_LEVEL0_TEXELS),depth.depthInverse,depth.bias.z);`

/** A lamp's page off the sample's (\`vsmFilterPage\`): its coarser mip has its depth's scale, and
 *  the finer entry holds that mip's page. */
const LAMP_PAGE = ` return VsmFilterPage(select(2u,1u,e.thisLevelMapped),e.physicalAddress,(page>>vec2u(e.coarserLevels))*VSM_PAGE_TEXELS,1.0/pow2FromExponent(i32(e.coarserLevels)),vec2f(0.0),1.0,0.0);`

/** The filtered read's functions of one kind of map (\`vsmShadowReadWgsl\`), named for it: \`Sun\`, a
 *  clipmap level's, \`Local\`, a lamp's — the page a texel off the sample's is read in, and the taps
 *  through it, which choose no kind in their loop. */
const vsmFilterKindWgsl = (kind: 'Sun' | 'Local') => `
/** Page \`page\` of the level \`sm\` was read at, through the page table. */
fn vsmFilterPage${kind}(requested:VsmHandle,sm:VsmMapRead,page:vec2u)->VsmFilterPage{
 let e=vsmTableEntryAtOffset(vsmTableEntryOf(sm.handle,sm.mipLevel,page));
 if(!e.anyLevelMapped){return VsmFilterPage(0u,vec2u(0u),vec2u(0u),1.0,vec2f(0.0),1.0,0.0);}
${kind === 'Sun' ? CLIPMAP_PAGE : LAMP_PAGE}
}
fn vsmFilterPageOf${kind}(requested:VsmHandle,sm:VsmMapRead,page:vec2u,home:vec2u,own:VsmFilterPage)->VsmFilterPage{
 if(all(page==home)){return own;}
 return vsmFilterPage${kind}(requested,sm,page);
}
/** The filtered read around sample \`sm\` of a map requested at \`requested\`, for a receiver at depth
 *  \`z\`, receiver plane \`slope\` (\`vsmConsumerSlope\`): the share of the light the opaque casters
 *  let through. The texels are compared first, a bit a texel: a block all in shadow reads 0, one
 *  all lit 1, exactly, and only the others weigh the taps. */
fn vsmFilterTaps${kind}(requested:VsmHandle,sm:VsmMapRead,z:f32,slope:vec4f)->f32{
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
   let rec=vsmFilterPageOf${kind}(requested,sm,pageLo+s,home,own);
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
}`

/**
 * The shadow read of every lit surface, through the virtual shadow maps (`../../vsm/`).
 * A shadowed light's `params.y` is `firstVsmId · 64 + channel`, −1 without a shadow
 * (`encodeVsm.ts`). The opaque resolve reads the frame's traced shadow mask
 * (`encodeVirtualShadowProjection`) at its own pixel (`vsmMaskPixel`, set by its shadow setup),
 * the light's channel, and the located sample (`vsmTransmissionRead`) for the translucent casters'
 * transmission alone. The blend and water passes read the filtered taps (`vsmShadowRead`). A
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
 * The block lists what it calls, the maths library's declarations included.
 */
export const directShadowWgsl = (
  maskBinding: number,
  {
    resolveTransmission = null,
    vsm = CONTRACT_VSM_BINDINGS,
    kinds = ALL_SHADOW_KINDS,
  }: DirectShadowOptions = {},
) =>
  wgslBlock(
    `directShadowWgsl(${maskBinding}, ${resolveTransmission}, ${vsmBindingsLabel(vsm)}, ${shadowKindsLabel(kinds)})`,
    [
      SHADOW_VIEW_WGSL,
      vsmConsumerWgsl(vsm, {
        transmission: resolveTransmission ?? maskBinding,
        pool: resolveTransmission === null,
        kinds,
      }),
      resolveTransmission === null ? vsmShadowReadWgsl(kinds) : vsmMaskWgsl(maskBinding),
    ],
    `
var<private> shadowFootprint:f32=0.0;
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
var<private> shadowReceiverPlane:vec3f=vec3f(0.0);
var<private> shadowTransmission:vec3f=vec3f(1.0);
fn shadowBiasNormal(n:vec3f,g:vec3f)->vec3f{
 if(dot(g,g)==0.0){return n;}
 return select(g,-g,dot(g,n)<0.0);
}
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
}`,
  )

/** What a shadow read takes past its mask's binding (`directShadowWgsl`): the opaque resolve's
 *  binding of the translucent casters' transmission (none in a blend or water pass), the virtual
 *  shadow maps' bindings and the light kinds read. */
export type DirectShadowOptions = {
  resolveTransmission?: number | null
  vsm?: VsmConsumerBindings
  kinds?: ShadowKinds
}

const vsmMaskWgsl = (binding: number) =>
  wgslBlock(
    `vsmMaskWgsl(${binding})`,
    [VSM_MASK_TABLE_READ_WGSL, byteOf],
    `
@group(0) @binding(${binding}) var vsmShadowMask:texture_2d_array<u32>;
@group(0) @binding(${VSM_MASK_TILES_BINDING}) var vsmShadowMaskTiles:texture_2d<u32>;
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
/** The translucent casters' transmission at \`P\` alone, into \`shadowTransmission\`: the located
 *  sample (\`vsmLocate\`), without an opaque compare — the mask holds the opaque shadow —, read only
 *  where its physical page holds a translucent slice: elsewhere all the light passes, as
 *  \`shadowFactor\` set it, at the lookup's cost alone on the pages no pane covers. */
fn vsmTransmissionRead(id:u32,directional:bool,P:vec3f,N:vec3f){
 let fromEye=vsmReceiverFromEye(P,normalize(N));
 let at=vsmLocate(id,directional,fromEye);
 if(!vsmTransmissionPaned(at.sm)){return;}
 shadowTransmission=vsmTransmissionThrough(at.sm,at.fromMap,fromEye,shadowCamera,at.clipmap);
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
 return vsmMaskDecode(byteOf(vsmMaskWord,channel%4u));
}`,
  )
