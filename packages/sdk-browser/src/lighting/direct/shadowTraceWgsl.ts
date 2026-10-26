// The shadow read's pieces past the maps (`shadowWgsl.ts`): a blend's own trace, the masks the
// opaque resolve reads.
import { ONE_PASS_MASK_WGSL, VSM_SUN_MASK_FORMAT } from '../shadows/vsm/projection/maskFormat.ts'
import { VSM_LIGHT_GRID_WGSL } from '../shadows/vsm/projection/lightGridWgsl.ts'
import { VSM_SHADOW_FILTER_WGSL } from '../shadows/vsm/trace/shadowFilterWgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { SHADOW_SLICE_WGSL } from './shadowSlice.ts'
import { DFSH_MAX_LIGHTS, DFSH_NO_MASK_WORDS } from '../distanceField/shadow/layout.ts'
import { vsmReceiverTraceWgsl } from '../shadows/vsm/trace/receiverTraceWgsl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from '../shadows/vsm/projection/projectionView.ts'
import { vsmTraceLightWgsl } from '../shadows/vsm/trace/traceWgsl.ts'
import { vsmSampleLightWgsl } from '../shadows/vsm/sampleLightWgsl.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../reflections/viewLayout.ts'
import { forwardPool, vsmTraceBindingsLabel, type VsmTraceBindings } from './shadowBindings.ts'

/** The shadow projection's view uniform (`VsmProjectionView`) at `binding` of group `group`: what a
 *  fragment's trace reads. */
export const vsmTraceViewWgsl = (binding: number, kinds: number, group = 0) =>
  wgslBlock(
    `vsmTraceViewWgsl(${binding}, ${kinds}, ${group})`,
    [vsmTraceLightWgsl(kinds)],
    `
${VSM_PROJECTION_VIEW_STRUCT}
@group(${group}) @binding(${binding}) var<uniform> vsmView:VsmProjectionView;`,
  )

/**
 * A blended surface's trace (`vsmTraceFactor`): the receiver's trace of the
 * projection (`vsmReceiverTraceWgsl`), lone, at the fragment's point. Its pixel is the fragment's,
 * set before its lights (`vsmTraceAt`), which takes the blue noise there; its view depth, its
 * point shifted to the projection's origin and its screen ray are the projection's own
 * expressions; a thin two-sided surface takes no normal bias and no screen ray, as the projection's
 * subsurface pixel. Every receiver the trace reads is the light's: `facing` was tested by
 * `shadowFactor`, its range by `lampSeen`. It traces the light kinds `kinds` (`vsmTraceKindsOf`).
 */
export const vsmFragmentTraceWgsl = (pool: number, t: VsmTraceBindings, kinds: number) =>
  wgslBlock(
    `vsmFragmentTraceWgsl(${pool}, ${vsmTraceBindingsLabel(t)}, ${kinds})`,
    [
      vsmTraceViewWgsl(t.view, kinds),
      blueNoiseWgsl(0, t.noise, t.loadOnly),
      vsmReceiverTraceWgsl({
        pool: forwardPool(pool),
        noise: blueNoiseWgsl(0, t.noise, t.loadOnly),
        hiz: [REFLECTION_GROUP, REFLECTION_DEPTH_BINDING],
        lone: true,
        subgroups: t.subgroups,
        kinds,
      }),
      VSM_SHADOW_FILTER_WGSL,
    ],
    `
var<private> vsmTracePixel:vec2u=vec2u(0u);
/** The fragment the lights that follow are traced at (\`pixel\`, its framebuffer position). */
fn vsmTraceAt(pixel:vec2f){vsmTracePixel=vec2u(pixel);}
/** Light \`channel\`'s share at \`P\`, of normal \`N\`: the share of its rays that missed, dithered
 *  (\`vsmFilterShadow\`). */
fn vsmTraceFactor(channel:u32,P:vec3f,N:vec3f)->f32{
 var r:VsmPixel;
 r.pos=vsmTracePixel;
 r.inRect=true;
 r.info=VsmSurfaceInfo(true,thinSurface(),false,normalize(N),-1.0,false);
 r.shifted=(P+vsmView.originShiftHigh)+vsmView.originShiftLow;
 r.sceneDepth=(vsmView.shiftedToView*vec4f(r.shifted,1.0)).z;
 r.screenRayWorld=(vsmView.screenRayScale.xy*(vsm.screenRayLength*r.sceneDepth)+vsmView.screenRayScale.zw).y;
 r.noise=blueNoiseScalar(r.pos,vsmView.frameIndex);
 return vsmFilterShadow(vsmProjectLight(channel,r,true).shadowFactor,r.noise);
}`,
  )

/** The trace's pixel setter (`vsmFragmentTraceWgsl`) where no read takes a pixel: a sample, or no
 *  read at all. */
export const VSM_NO_PIXEL_WGSL = wgslFn('vsmTraceAt', [], 'fn vsmTraceAt(pixel:vec2f){}')

/**
 * A blended surface's one-sample read (`vsmSampleFactor`), the default for translucency
 * (`vsmSampleLightWgsl`), cheap enough for every layer of a blend: the light's map at the fragment's point, no ray, no noise,
 * no screen segment. Its fragment needs no pixel (`vsmTraceAt` keeps none), unless `pixel` is false,
 * where the program also holds the trace, whose own `vsmTraceAt` takes it.
 */
export const vsmFragmentSampleWgsl = (
  pool: number,
  view: number,
  kinds: number,
  group = 0,
  pixel = true,
) =>
  wgslBlock(
    `vsmFragmentSampleWgsl(${pool}, ${view}, ${kinds}, ${group}${pixel ? '' : ', traced beside'})`,
    [
      vsmTraceViewWgsl(view, kinds, group),
      vsmSampleLightWgsl(forwardPool(pool, group), kinds),
      ...(pixel ? [VSM_NO_PIXEL_WGSL] : []),
    ],
    `
/** Light \`channel\`'s share at \`P\`, one sample of its map. */
fn vsmSampleFactor(channel:u32,P:vec3f)->f32{
 return vsmSampleLight(vsmView.lights[channel],(P+vsmView.originShiftHigh)+vsmView.originShiftLow);
}`,
  )

/** The read of the sun's distance-field shadow at the pixel (`vsmFarFactor`), at `binding`: the byte
 *  of light `channel`'s lane of the word the shadow left there (`distanceField/shadow/finalWgsl.ts`:
 *  after the word of the row's width, a word a pixel), squared (it holds the square root of the
 *  visibility), 1 for a channel that has no lane (past the fourth) and where the image drew none (a
 *  one-word stand-in, or any stand-in a backend pads: its row's width is 0). */
const vsmFarMaskWgsl = (binding: number) =>
  wgslBlock(
    `vsmFarMaskWgsl(${binding})`,
    [byteOf],
    `
@group(0) @binding(${binding}) var<storage,read> vsmFarMask:array<u32>;
fn vsmFarFactor(channel:u32)->f32{
 if(channel>=${DFSH_MAX_LIGHTS}u||arrayLength(&vsmFarMask)<=${DFSH_NO_MASK_WORDS}u||vsmFarMask[0]==0u){return 1.0;}
 let word=vsmFarMask[1u+u32(vsmMaskPixel.y)*vsmFarMask[0]+u32(vsmMaskPixel.x)];
 let lane=f32(byteOf(word,channel))/255.0;
 return lane*lane;
}`,
  )

/** The suns' mask at `binding`: a layer a sun (`r32float`, `VSM_SUN_MASK_FORMAT`), read by load alone: a
 *  read-only storage texture, which spends none of the sixteen sampled textures of the widest program. */
const SUN_MASK_TYPE = `texture_storage_2d_array<${VSM_SUN_MASK_FORMAT},read>`

/**
 * The read of the projection's masks at the pixel, the lighting passes'. A sun's share is its layer of the
 * suns' mask (`sun`) at the pixel (`vsmSunFactor`), the least of it and the sun's distance-field
 * shadow's (`vsmFarFactor`) with `farMask`, the binding of that shadow. A local light's is its lane of the
 * local lights' mask (`local`, the binding of the texture, a texel a pixel): its four bits among the
 * pixel's, its lane its place among the shadowed lights of the pixel's cell in the shadowed lights'
 * grid (`grid`, `lightGridWgsl.ts`: the order the projection packs them in), over sixteen; a light whose
 * lane is past `shadowOnePassProjectionMaxLightsPerPixel` is read from one sample of its own map
 * (`vsmSampleMapLocal`, the program's `fallback`).
 */
export const vsmMaskWgsl = (sun: number, local?: number, farMask?: number, grid?: number) =>
  wgslBlock(
    `vsmMaskWgsl(${sun}, ${local ?? null}, ${farMask ?? null}, ${grid ?? null})`,
    [
      SHADOW_SLICE_WGSL,
      ...(farMask === undefined ? [] : [vsmFarMaskWgsl(farMask)]),
      ...(local === undefined ? [] : [VSM_LIGHT_GRID_WGSL, ONE_PASS_MASK_WGSL]),
    ],
    `
@group(0) @binding(${sun}) var vsmSunMask:${SUN_MASK_TYPE};
/** The resolve's pixel: the masks are read there; (−1, −1) in a pass that reads none. */
var<private> vsmMaskPixel:vec2i=vec2i(-1);
/** Sun \`layer\`'s share of its shadow at the pixel, the least of it and the sun's distance-field
 *  shadow's in a program that reads one. */
fn vsmSunFactor(layer:u32)->f32{
 let share=textureLoad(vsmSunMask,vsmMaskPixel,layer).r;
 return ${farMask === undefined ? 'share' : 'min(share,vsmFarFactor(layer))'};
}${
      local === undefined
        ? `
/** The pixel the masks are read at. */
fn vsmMaskAt(coord:vec2i){vsmMaskPixel=coord;}`
        : `
@group(0) @binding(${local}) var vsmLocalMask:texture_2d<u32>;
@group(0) @binding(${grid}) var<storage,read> vsmLightGrid:array<u32>;
/** The record of the pixel's cell of the light grid (\`pixelCell\`), and its shadowed lights' list and its
 *  word of the local mask, each read when a light first asks. */
var<private> vsmMaskBase:u32=TILE_NO_SLICE;
var<private> vsmMaskList:vec2u=vec2u(TILE_NO_SLICE,0u);
var<private> vsmMaskListed:bool=false;
var<private> vsmMaskWord:vec4u=vec4u(0u);
var<private> vsmMaskRead:bool=false;
/** The pixel the masks are read at and the record of its cell. */
fn vsmMaskAt(coord:vec2i,base:u32){vsmMaskPixel=coord;vsmMaskBase=base;vsmMaskListed=false;vsmMaskRead=false;}
/** The lane of the shadowed local light of slice \`slice\`: its place among the first lanes the mask
 *  keeps of the shadowed lights of the pixel's cell (\`vsmShadowedList\`), \`vsm.onePassMaxLights\`
 *  for a light past them. */
fn vsmMaskLaneOf(slice:i32)->u32{
 if(!vsmMaskListed){vsmMaskList=vsmShadowedList(vsmMaskBase);vsmMaskListed=true;}
 let lanes=min(vsmMaskList.y,vsm.onePassMaxLights);
 for(var lane=0u;lane<lanes;lane++){
  if(i32(directLights.items[vsmShadowedRank(vsmMaskList,lane)].params.y)==slice){return lane;}
 }
 return vsm.onePassMaxLights;
}
/** The share of the shadowed local light of slice \`slice\` at \`P\`: its four bits of the pixel's mask, or,
 *  past the lanes the mask keeps (\`vsm.onePassMaxLights\`), one sample of its own map. */
fn vsmLocalFactor(slice:i32,P:vec3f)->f32{
 let lane=vsmMaskLaneOf(slice);
 if(lane<vsm.onePassMaxLights){
  if(!vsmMaskRead){vsmMaskWord=textureLoad(vsmLocalMask,vec2u(vsmMaskPixel),0);vsmMaskRead=true;}
  return f32((vsmMaskWord[lane/ONE_PASS_MASK_LANES]>>((lane%ONE_PASS_MASK_LANES)*ONE_PASS_MASK_BITS))&ONE_PASS_MASK_MAX)/f32(ONE_PASS_MASK_MAX);
 }
 return vsmSampleMapLocal(u32(vsmView.lights[shadowSliceRecord(slice)].mapId),(P+vsmView.originShiftHigh)+vsmView.originShiftLow,VSM_MASK_FALLBACK_START);
}`
    }`,
  )
