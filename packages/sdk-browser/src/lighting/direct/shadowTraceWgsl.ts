// The shadow read's pieces past the maps (`shadowWgsl.ts`): the translucent casters'
// transmission at a receiver, a blend's or the water's own trace, the resolve's mask.
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { VSM_PROJECTION_GROUP_SHIFT } from '../../vsm/projectionWgsl.ts'
import { vsmReceiverTraceWgsl } from '../../vsm/receiverTraceWgsl.ts'
import { vsmBlueNoiseTwo, vsmBlueNoiseWgsl } from '../../vsm/blueNoise.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from '../../vsm/projectionView.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import {
  forwardPool,
  vsmBindingsLabel,
  vsmTraceBindingsLabel,
  type VsmConsumerBindings,
  type VsmTraceBindings,
} from './shadowBindings.ts'

/** The translucent casters' transmission at a receiver, every pass's (`directShadowWgsl`). */
export const VSM_TRANSMISSION_AT_WGSL = wgslBlock(
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
export const vsmFragmentTraceWgsl = (vsm: VsmConsumerBindings, t: VsmTraceBindings) =>
  wgslBlock(
    `vsmFragmentTraceWgsl(${vsmBindingsLabel(vsm)}, ${vsmTraceBindingsLabel(t)})`,
    [
      vsmBlueNoiseWgsl(0, t.noise),
      vsmReceiverTraceWgsl({
        pool: forwardPool(vsm.pool),
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

/** The opaque resolve's read of the projection's mask at its pixel (`vsmMaskFactor`). */
export const vsmMaskWgsl = (binding: number) =>
  wgslBlock(
    `vsmMaskWgsl(${binding})`,
    [byteOf],
    `
@group(0) @binding(${binding}) var vsmShadowMask:texture_2d_array<u32>;
@group(0) @binding(${DEFERRED_BINDINGS.maskTiles}) var vsmShadowMaskTiles:texture_2d<u32>;
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
