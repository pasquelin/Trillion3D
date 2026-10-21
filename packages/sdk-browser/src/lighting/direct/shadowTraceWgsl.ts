// The shadow read's pieces past the maps (`shadowWgsl.ts`): a blend's own trace, the mask and its
// transmission the opaque resolve reads.
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import { VSM_PROJECTION_TILE_FORMAT } from '../shadows/vsm/projection/projectionWgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { VSM_MASK_THROUGH_SHIFT, VSM_PROJECTION_GROUP_SHIFT } from '../shadows/vsm/constants.ts'
import { vsmReceiverTraceWgsl } from '../shadows/vsm/trace/receiverTraceWgsl.ts'
import { vsmBlueNoiseTwo, vsmBlueNoiseWgsl } from '../shadows/vsm/blueNoise.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from '../shadows/vsm/projection/projectionView.ts'
import { vsmTraceLightWgsl } from '../shadows/vsm/trace/traceWgsl.ts'
import { vsmSampleLightWgsl } from '../shadows/vsm/sampleLightWgsl.ts'
import { vsmTransmissionReadWgsl } from '../shadows/vsm/transmission/transmissionReadWgsl.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../reflections/viewLayout.ts'
import { forwardPool, vsmTraceBindingsLabel, type VsmTraceBindings } from './shadowBindings.ts'

/** The shadow projection's view uniform (`VsmProjectionView`) at `binding`: what a fragment's trace
 *  reads. */
const vsmTraceViewWgsl = (binding: number, kinds: number) =>
  wgslBlock(
    `vsmTraceViewWgsl(${binding}, ${kinds})`,
    [vsmTraceLightWgsl(kinds)],
    `
${VSM_PROJECTION_VIEW_STRUCT}
@group(0) @binding(${binding}) var<uniform> vsmView:VsmProjectionView;`,
  )

/**
 * A blended surface's trace (`vsmTraceFactor`): the receiver's trace of the
 * projection (`vsmReceiverTraceWgsl`), lone, at the fragment's point. Its pixel is the fragment's,
 * set before its lights (`vsmTraceAt`), which takes the blue noise there; its view depth, its
 * point shifted to the projection's origin and its screen ray are the projection's own
 * expressions; a thin two-sided surface takes no normal bias and no screen ray, as the projection's
 * subsurface pixel. Every receiver the trace reads is the light's: `facing` was tested by
 * `shadowFactor`, its range by `directIncidence`. Its rays read the translucent casters' memory at
 * `transmission` (`vsmRayThrough`), whose average over the missed rays it writes into
 * `shadowTransmission`; it traces the light kinds `kinds` (`vsmTraceKindsOf`).
 */
export const vsmFragmentTraceWgsl = (
  pool: number,
  t: VsmTraceBindings,
  transmission: number,
  kinds: number,
) =>
  wgslBlock(
    `vsmFragmentTraceWgsl(${pool}, ${vsmTraceBindingsLabel(t)}, ${transmission}, ${kinds})`,
    [
      vsmTraceViewWgsl(t.view, kinds),
      vsmBlueNoiseWgsl(0, t.noise),
      vsmReceiverTraceWgsl({
        pool: forwardPool(pool),
        noise: vsmBlueNoiseTwo(0, t.noise),
        hiz: [REFLECTION_GROUP, REFLECTION_DEPTH_BINDING],
        lone: true,
        subgroups: t.subgroups,
        transmission: vsmTransmissionReadWgsl(transmission),
        kinds,
      }),
    ],
    `
var<private> vsmTracePixel:vec2u=vec2u(0u);
/** The fragment the lights that follow are traced at (\`pixel\`, its framebuffer position). */
fn vsmTraceAt(pixel:vec2f){vsmTracePixel=vec2u(pixel);}
/** Light \`channel\`'s share at \`P\`, of bias normal \`N\`: the share of its rays that missed, what
 *  the panes let through along them into \`shadowTransmission\`. */
fn vsmTraceFactor(channel:u32,P:vec3f,N:vec3f)->f32{
 let n=normalize(N);
 var r:VsmPixel;
 r.pos=vsmTracePixel;
 r.inRect=true;
 r.info=VsmSurfaceInfo(true,thinSurface(),n,n);
 r.shifted=(P+vsmView.originShiftHigh)+vsmView.originShiftLow;
 r.sceneDepth=(vsmView.shiftedToView*vec4f(r.shifted,1.0)).z;
 r.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayShare*r.sceneDepth)+vsmView.screenRayScale.zw).y;
 r.noise=vsmNoiseOne(r.pos,vsmView.frameIndex);
 let traced=vsmProjectLight(channel,r,true);
 shadowTransmission=traced.through;
 return traced.shadowFactor;
}`,
  )

/** The trace's pixel setter (`vsmFragmentTraceWgsl`) where no read takes a pixel: a sample, or no
 *  read at all. */
export const VSM_NO_PIXEL_WGSL = wgslFn('vsmTraceAt', [], 'fn vsmTraceAt(pixel:vec2f){}')

/**
 * A blended surface's one-sample read (`vsmSampleFactor`), the default for translucency
 * (`vsmSampleLightWgsl`), cheap enough for every layer of a blend: the light's map at the fragment's point, no ray, no noise,
 * no screen segment, nothing of the translucent casters. Its fragment needs no pixel
 * (`vsmTraceAt` keeps none).
 */
export const vsmFragmentSampleWgsl = (pool: number, view: number, kinds: number) =>
  wgslBlock(
    `vsmFragmentSampleWgsl(${pool}, ${view}, ${kinds})`,
    [
      vsmTraceViewWgsl(view, kinds),
      vsmSampleLightWgsl(forwardPool(pool), kinds),
      VSM_NO_PIXEL_WGSL,
    ],
    `
/** Light \`channel\`'s share at \`P\`, one sample of its map. */
fn vsmSampleFactor(channel:u32,P:vec3f)->f32{
 return vsmSampleLight(vsmView.lights[channel],(P+vsmView.originShiftHigh)+vsmView.originShiftLow);
}`,
  )

/** The mask's tile words, read by load alone: a read-only storage texture, which spends none of the
 *  sixteen sampled textures of the widest program (`loadOnlyTarget`). */
export const MASK_TILES_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.maskTiles,
  VSM_PROJECTION_TILE_FORMAT,
  'vsmShadowMaskTiles',
)

/** The read of a projection's mask and its transmission at the pixel (`vsmMaskFactor`,
 *  `vsmMaskThrough`), at `binding` and `through`: the opaque resolve's. */
export const vsmMaskWgsl = (binding: number, through: number) =>
  wgslBlock(
    `vsmMaskWgsl(${binding}, ${through})`,
    [byteOf],
    `
@group(0) @binding(${binding}) var vsmShadowMask:texture_2d_array<u32>;
@group(0) @binding(${through}) var vsmShadowThrough:texture_2d_array<f32>;
${MASK_TILES_TARGET.wgsl}
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
var<private> vsmMaskLayer:u32=VSM_MASK_NO_LAYER;
var<private> vsmMaskWord:u32=0u;
/** The layers the projection stored in the pixel's tile, bit L for layer L (its tile word,
 *  \`vsm/projectionWgsl.ts\`): those holding a light it traced there, each a layer of the mask; every
 *  lane of another is 0. None before \`vsmMaskAt\`; \`VSM_MASK_TILE_UNREAD\` after it, until the
 *  pixel's first light that reads the mask loads it (\`vsmMaskFactor\`). */
var<private> vsmMaskTile:u32=0u;
/** No layer loaded yet: no layer has this rank. */
const VSM_MASK_NO_LAYER:u32=0xffffffffu;
/** No tile word: its sixteen layers' bits never set the high ones. */
const VSM_MASK_TILE_UNREAD:u32=0xffffffffu;
/** The pixel the mask is read at (\`shadowSetup\`): its tile's word is loaded when a light reads it. */
fn vsmMaskAt(coord:vec2i){
 vsmMaskPixel=coord;vsmMaskLayer=VSM_MASK_NO_LAYER;vsmMaskTile=VSM_MASK_TILE_UNREAD;
}
/** Light \`channel\`'s factor: its 8-bit lane of layer channel / 4 (\`vsmMaskCode\`), decoded — 1, the
 *  decode of a lane 0, where its tile stored no such layer, which is then not read. The layer's
 *  word is loaded once for the pixel, whatever the number of lights it holds. */
fn vsmMaskFactor(channel:u32)->f32{
 if(vsmMaskTile==VSM_MASK_TILE_UNREAD){
  vsmMaskTile=textureLoad(vsmShadowMaskTiles,vsmMaskPixel>>vec2u(${VSM_PROJECTION_GROUP_SHIFT}u)).r;
 }
 let layer=channel>>2u;
 if((vsmMaskTile&(1u<<layer))==0u){return 1.0;}
 if(layer!=vsmMaskLayer){
  vsmMaskWord=textureLoad(vsmShadowMask,vsmMaskPixel,layer,0).r;
  vsmMaskLayer=layer;
 }
 return vsmMaskDecode(byteOf(vsmMaskWord,channel%4u));
}
/** What the translucent casters let through along light \`channel\`'s missed rays (its layer of the
 *  mask's transmission, \`vsmProjectTile\`), read after its factor (\`vsmMaskFactor\`, which loads the
 *  tile word): 1 where its tile stored no pane's colour of its layer (bit
 *  \`VSM_MASK_THROUGH_SHIFT\` + layer, \`vsmFillThrough\`), or the frame holds no translucent caster
 *  (a one-texel stand-in). */
fn vsmMaskThrough(channel:u32)->vec3f{
 if(textureDimensions(vsmShadowThrough).x<=1u||(vsmMaskTile&(1u<<(${VSM_MASK_THROUGH_SHIFT}u+(channel>>2u))))==0u){return vec3f(1.0);}
 return textureLoad(vsmShadowThrough,vsmMaskPixel,channel,0).rgb;
}`,
  )
