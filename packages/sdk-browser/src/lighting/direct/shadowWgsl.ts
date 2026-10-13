import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { SHADOW_VIEW_WGSL } from './shadowViewWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import { VSM_UNIFORMS_WGSL } from '../../vsm/uniforms.ts'
import { vsmPoolWindowBindings, vsmPoolWindowsWgsl } from '../../vsm/poolWindows.ts'
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
import { VSM_MASK_TILES_BINDING } from '../../vsm/projectionWgsl.ts'
import { VSM_PROJECTION_GROUP_SHIFT } from '../../vsm/projectionWgsl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { vsmReceiverTraceWgsl } from '../../vsm/receiverTraceWgsl.ts'
import { vsmBlueNoiseTwo, vsmBlueNoiseWgsl } from '../../vsm/blueNoise.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from '../../vsm/projectionView.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import {
  ALL_SHADOW_KINDS,
  byShadowKind,
  shadowKindsLabel,
  type ShadowKinds,
} from './shadowKinds.ts'

/** Where a pass binds the virtual shadow maps a consumer samples (`vsmLocate`): the page
 *  table, the projection data, the uniforms and the windows of the pool's first slice
 *  (`vsmPoolWindowsWgsl`). */
export interface VsmConsumerBindings {
  pageTable: number
  projectionData: number
  uniforms: number
  pool: readonly number[]
}
/** The opaque resolve's and the water composite's numbers (the records', atlas, sampler and
 *  translucent depth). */
export const CONTRACT_VSM_BINDINGS: VsmConsumerBindings = {
  pageTable: DEFERRED_BINDINGS.pageTable,
  projectionData: DEFERRED_BINDINGS.projectionData,
  uniforms: DEFERRED_BINDINGS.uniforms,
  pool: vsmPoolWindowBindings(DEFERRED_BINDINGS.pool),
}
/** The water composite's trace bindings (`vsmTraceFactor`), on the deferred numbers. */
export const CONTRACT_TRACE_BINDINGS: VsmTraceBindings = {
  view: DEFERRED_BINDINGS.shadowView,
  noise: DEFERRED_BINDINGS.shadowNoise,
}
/** The bindings as a block name reads them, in their declared order. */
export const vsmBindingsLabel = (b: VsmConsumerBindings) =>
  `${b.pageTable}, ${b.projectionData}, ${b.uniforms}, ${b.pool.join(' ')}`

/** The opaque resolve binds no pool: its opaque shadow is the mask's, and its transmission read
 *  takes a sample's page, never its depth (`vsmTransmissionRead`), so a depth reads 0 there, which
 *  no read takes. Its stage holds the eight storage buffers WebGPU guarantees
 *  (`deferredLayoutEntries`). */
const RESOLVE_POOL = wgslFn('vsmPoolLoad', [], 'fn vsmPoolLoad(t:vec2u,slice:u32)->u32{return 0u;}')

/**
 * Where a point is read in a virtual shadow map (`vsmLocate`) — directional or local, one page-table
 * lookup with a coarser-level fallback — for VSM id `id`: what the translucent casters'
 * transmission read starts from (`vsmTransmissionRead`), at a point `P` of unit normal `N` moved
 * along it by the normal bias length (`vsmReceiverFromEye`). The origin shift is the pass's eye
 * (`shadowCamera`), in single precision. `pool`: the pass reads the pool (`vsmPoolWindowsWgsl`),
 * which the traces sample (`vsmTraceWgsl`); the opaque resolve does not.
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
      vsmProjectionSampleWgsl(pool ? vsmPoolWindowsWgsl(b.pool) : RESOLVE_POOL),
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
 let inverseTangent=1.0/max(shadowAngularPixel*shadowViewWidth*0.5,1e-6);
 return (P-shadowCamera)+N*vsmNormalOffsetLength(vsm.normalBias,distanceToCamera,inverseTangent);
}
/** Where a receiver \`fromEye\` (\`vsmReceiverFromEye\`) is read in map \`id\`: its sample \`sm\` —
 *  invalid where no page holds the point, nothing mapped at any level —, whether it is a sun's
 *  clipmap level (\`clipmap\`), whose sample may fall back to a coarser one (\`sm.handle\`), or a
 *  local light's map, and the receiver in the map's shifted frame. */
struct VsmLocated{sm:VsmMapRead,clipmap:bool,fromMap:vec3f,}
fn vsmLocate(id:u32,directional:bool,fromEye:vec3f)->VsmLocated{
 let shiftHigh=-shadowCamera;let shiftLow=vec3f(0.0);
 ${byShadowKind(
   kinds,
   `  let h=vsmHandleFromIdDirectional(id);
  let base=vsmProjectionOf(h);
  let d2=vsmDistanceSqToOrigin(base,fromEye,shiftHigh,shiftLow);
  let level=i32(floor(vsmSampledLevel(base,d2)));
  let index=max(0,level-base.mapLevel);
  if(index>=base.levelsLeft){return VsmLocated(vsmEmptyRead(),true,vec3f(0.0));}
  let requested=vsmHandleOffset(h,index);
  let pd=vsmProjectionOf(requested);
  let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
  let uvz=pd.shiftedToMapUv*vec4f(fromMap,1.0);
  return VsmLocated(vsmReadClipmap(requested,uvz.xy),true,fromMap);`,
   ` var h=vsmHandleFromId(id);
 var pd=vsmProjectionOf(h);
 let fromMap=fromEye+vsmSubtractHighLow(pd.originShiftHigh,pd.originShiftLow,shiftHigh,shiftLow);
 if(pd.lightKind!=LIGHT_KIND_SPOT){h=vsmHandleOffset(h,i32(vsmCubeFace(fromMap)));pd=vsmProjectionOf(h);}
 let uvz=perspectiveDivide(pd.shiftedToMapUv*vec4f(fromMap,1.0));
 return VsmLocated(vsmReadMap(h,uvz.xy,pd.finestMip),false,fromMap);`,
 )}
}`,
  )

/**
 * The shadow read of every lit surface, through the virtual shadow maps (`../../vsm/`): one
 * estimator, the receiver's trace (`vsmReceiverTraceWgsl`). A shadowed light's `params.y` is
 * `firstVsmId · 64 + channel`, −1 without a shadow (`vsmEncode.ts`), its channel the light's rank in
 * the frame's projection (`vsmView.lights`). The opaque resolve reads the trace the projection pass
 * stored in the frame's mask (`encodeVirtualShadowProjection`) at its own pixel (`vsmMaskPixel`,
 * set by its shadow setup). A blended surface and the water, which the mask cannot hold, trace
 * their own fragment (`vsmTraceFactor`) on the same view, noise and maps. Every pass then reads the
 * located sample (`vsmTransmissionRead`) for the translucent casters' transmission alone.
 *
 * The resolve reads a shadow only in a cell its shadow setup set the mask pixel of
 * (`cellShadowed`, `shadowSetup`): a cell whose list holds a light with a shadow slot, or — no room
 * for its list — that walks every light, where a light of no list of the cell gives its points
 * exactly zero before any shadow read (`declaredLight`, `incidence.w`), as the lists rest on.
 *
 * `resolveTransmission` is the opaque resolve's binding of the translucent casters' transmission
 * (`VSM_TRANSMISSION_RESOLVE_BINDING`), null in a blend or water pass; `maskBinding` the resolve's
 * mask array, and in the other passes, which declare no mask, their transmission. `trace`, the
 * bindings a blend or water pass traces with (the water's, `CONTRACT_TRACE_BINDINGS`, unless given). The names the passes write (footprint, receiver
 * offset and plane, view) are kept, so their bodies need no change. The block lists what it calls,
 * the maths library's declarations included.
 */
export const directShadowWgsl = (
  maskBinding: number,
  {
    resolveTransmission = null,
    vsm = CONTRACT_VSM_BINDINGS,
    kinds = ALL_SHADOW_KINDS,
    trace = CONTRACT_TRACE_BINDINGS,
  }: DirectShadowOptions = {},
) => {
  const label = `directShadowWgsl(${maskBinding}, ${resolveTransmission}, ${vsmBindingsLabel(vsm)}, ${shadowKindsLabel(kinds)}, ${vsmTraceBindingsLabel(trace)})`
  if (resolveTransmission === null)
    return wgslBlock(
      label,
      [
        SHADOW_VIEW_WGSL,
        vsmConsumerWgsl(vsm, { transmission: maskBinding, pool: true, kinds }),
        VSM_TRANSMISSION_AT_WGSL,
        vsmFragmentTraceWgsl(vsm, trace),
      ],
      shadowFactorWgsl(`
 let factor=vsmTraceFactor(u32(slice)&63u,P,N);
 if(factor>0.0&&vsmTranslucentCasters()){vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}
 return factor;`),
    )
  return wgslBlock(
    label,
    [
      SHADOW_VIEW_WGSL,
      vsmConsumerWgsl(vsm, { transmission: resolveTransmission, pool: false, kinds }),
      VSM_TRANSMISSION_AT_WGSL,
      vsmMaskWgsl(maskBinding),
    ],
    shadowFactorWgsl(`
 let mask=vsmMaskFactor(u32(slice)&63u);
 // The traced mask is opaque only: the translucent casters' colour from the page-table lookup.
 if(mask>0.0&&vsmTranslucentCasters()){vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}
 return mask;`),
  )
}

/** The names every pass's shadow read writes, and \`shadowFactor\` reading a shadowed light's share
 *  through \`read\`. */
const shadowFactorWgsl = (read: string) => `
var<private> shadowFootprint:f32=0.0;
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
var<private> shadowReceiverPlane:vec3f=vec3f(0.0);
var<private> shadowTransmission:vec3f=vec3f(1.0);
fn shadowBiasNormal(n:vec3f,g:vec3f)->vec3f{
 if(dot(g,g)==0.0){return n;}
 return select(g,-g,dot(g,n)<0.0);
}
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,facing:bool)->f32{
 shadowTransmission=vec3f(1.0);
 if(slice<0){return 1.0;}
 if(!facing){return 0.0;}${read}
}`

/** Where a blend or water pass binds what its fragments trace with past the maps: the projection's
 *  view uniform (`VsmProjectionView`) and its blue noise. Their screen ray marches the depth pyramid
 *  their reflection group holds (`REFLECTION_GROUP`): the very pyramid the projection marches. */
export interface VsmTraceBindings {
  view: number
  noise: number
}
const vsmTraceBindingsLabel = (t: VsmTraceBindings) => `${t.view} ${t.noise}`

/** What a shadow read takes past its mask's binding (`directShadowWgsl`): the opaque resolve's
 *  binding of the translucent casters' transmission (none in a blend or water pass), the virtual
 *  shadow maps' bindings, the light kinds read, and a blend or water pass's trace bindings. */
export type DirectShadowOptions = {
  resolveTransmission?: number | null
  vsm?: VsmConsumerBindings
  kinds?: ShadowKinds
  trace?: VsmTraceBindings
}

/** The translucent casters' transmission at a receiver, every pass's (`directShadowWgsl`). */
const VSM_TRANSMISSION_AT_WGSL = wgslBlock(
  'VSM_TRANSMISSION_AT_WGSL',
  [],
  `
/** Whether the frame holds translucent casters' transmission: a one-texel stand-in otherwise. */
fn vsmTranslucentCasters()->bool{return textureDimensions(vsmTransmissionMemory).x>1u;}
/** The translucent casters' transmission at \`P\` alone, into \`shadowTransmission\`: the located
 *  sample (\`vsmLocate\`), without an opaque compare — the trace holds the opaque shadow —, read only
 *  where its physical page holds a translucent slice: elsewhere all the light passes, as
 *  \`shadowFactor\` set it, at the lookup's cost alone on the pages no pane covers. */
fn vsmTransmissionRead(id:u32,directional:bool,P:vec3f,N:vec3f){
 let fromEye=vsmReceiverFromEye(P,normalize(N));
 let at=vsmLocate(id,directional,fromEye);
 if(!vsmTransmissionPaned(at.sm)){return;}
 shadowTransmission=vsmTransmissionThrough(at.sm,at.fromMap,fromEye,shadowCamera,at.clipmap);
}`,
)

/**
 * A blended surface's or the water's trace (`vsmTraceFactor`): the receiver's trace of the
 * projection (`vsmReceiverTraceWgsl`), lone, at the fragment's point. Its pixel is the fragment's,
 * set before its lights (`vsmTraceAt`), which takes the blue noise there; its view depth, its
 * point shifted to the projection's origin and its screen ray are the projection's own
 * expressions; a thin two-sided surface takes no normal bias and no screen ray, as the projection's
 * subsurface pixel. Every receiver the trace reads is the light's: `facing` was tested by
 * `shadowFactor`, its range by `directIncidence`.
 */
const vsmFragmentTraceWgsl = (vsm: VsmConsumerBindings, t: VsmTraceBindings) =>
  wgslBlock(
    `vsmFragmentTraceWgsl(${vsmBindingsLabel(vsm)}, ${vsmTraceBindingsLabel(t)})`,
    [
      vsmBlueNoiseWgsl(0, t.noise),
      vsmReceiverTraceWgsl({
        pool: vsmPoolWindowsWgsl(vsm.pool),
        noise: vsmBlueNoiseTwo(0, t.noise),
        hiz: [REFLECTION_GROUP, REFLECTION_DEPTH_BINDING],
        lone: true,
      }),
    ],
    `
${VSM_PROJECTION_VIEW_STRUCT}
@group(0) @binding(${t.view}) var<uniform> vsmView:VsmProjectionView;
var<private> vsmTracePixel:vec2u=vec2u(0u);
/** The fragment the lights that follow are traced at (\`pixel\`, its framebuffer position). */
fn vsmTraceAt(pixel:vec2f){vsmTracePixel=vec2u(pixel);}
/** Light \`channel\`'s share at \`P\`, of bias normal \`N\`: the share of its rays that missed. */
fn vsmTraceFactor(channel:u32,P:vec3f,N:vec3f)->f32{
 let n=normalize(N);
 var r:VsmPixel;
 r.pos=vsmTracePixel;
 r.inRect=true;
 r.info=VsmSurfaceInfo(true,any(thinSubsurface>vec3f(0.0)),n,n);
 r.shifted=(P+vsmView.originShiftHigh)+vsmView.originShiftLow;
 r.sceneDepth=(vsmView.shiftedToView*vec4f(r.shifted,1.0)).z;
 r.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayShare*r.sceneDepth)+vsmView.screenRayScale.zw).y;
 r.noise=vsmNoiseOne(r.pos,vsmView.frameIndex);
 return vsmProjectLight(channel,r,true,false).shadowFactor;
}`,
  )

const vsmMaskWgsl = (binding: number) =>
  wgslBlock(
    `vsmMaskWgsl(${binding})`,
    [byteOf],
    `
@group(0) @binding(${binding}) var vsmShadowMask:texture_2d_array<u32>;
@group(0) @binding(${VSM_MASK_TILES_BINDING}) var vsmShadowMaskTiles:texture_2d<u32>;
/** A lane's code to its factor (\`vsmMaskCode\`, \`vsm/projectionWgsl.ts\`): 1 where no ray was
 *  traced, else the k of its n rays that missed, k / n by the projection's own expression, as the
 *  half float the mask held. */
fn vsmMaskDecode(code:u32)->f32{
 let rayCount=code>>4u;
 if(rayCount==0u){return 1.0;}
 return unpack2x16float(pack2x16float(vec2f(f32(code&15u)/f32(rayCount),0.0))).x;
}
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
