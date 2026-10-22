import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { HALF_MAX } from '../../../../../math/src/constants.ts'
import { uvToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { DITHER_WGSL } from '../../../post/taa/colorSpaceWgsl.ts'
import { YCOCG_WGSL } from '../../../post/taa/ycocgWgsl.ts'
import { LIGHT_SHAFT_TEMPORAL } from './describe.ts'

/**
 * The temporal filter of the light shafts' image, as a uniform, bindings and a program. It is the
 * view's temporal accumulation run on the shafts' low-resolution image, with its own settings
 * (`LIGHT_SHAFT_TEMPORAL`) and without the main pass's visibility-buffer machinery, which the shafts'
 * image has no use for: a pixel's history is found from the pixel's depth and the camera's move alone.
 *
 * - `clipToPrevClip`: from the clip space of this image, without jitter, to the last image's, without
 *   jitter, both at this image's eye (column-major, applied to a column vector);
 * - `outputSize`: the shafts' image view, `(width, height, 1/width, 1/height)`;
 * - `viewportUv`: the largest viewport coordinate a pixel reads, in `xy`, and the factor from a pixel
 *   centre to a viewport coordinate in `zw`;
 * - `inputUv`: the factor from a viewport coordinate to the shafts' texture coordinates in `xy`, its
 *   offset in `zw`;
 * - `inputRect`: the first and the last pixel of the shafts' image view, `(minX, minY, maxX, maxY)`;
 * - `history`: the factor from a screen position to the history's texture coordinates in `xy`, its
 *   offset in `zw`;
 * - `plusA`, `plusB`: the weights of the five pixels of the filter's plus, `plusA` the first four;
 * - `historyMax`: the largest screen position the history is read at, per axis;
 * - `exposure`: the factor that takes the shafts' stored colour to the colour the tone mapping sees,
 *   which the tone weights read, in `x`; the ratio of this image's exposure to the history's, which
 *   the history's colour is multiplied by, in `y`;
 * - `cut`: 1 when the history describes nothing; `slot`: the rank of the image among eight, which
 *   the output's rounding turns with; `quantization`: the rounding step of the output's format,
 *   relative to a channel.
 */
export const LIGHT_SHAFT_TEMPORAL_VIEW = fieldLayout('LightShaftTemporalView', [
  ['clipToPrevClip', 'mat4x4f'],
  ['outputSize', 'vec4f'],
  ['viewportUv', 'vec4f'],
  ['inputUv', 'vec4f'],
  ['inputRect', 'vec4f'],
  ['history', 'vec4f'],
  ['plusA', 'vec4f'],
  ['plusB', 'vec4f'],
  ['historyMax', 'vec2f'],
  ['exposure', 'vec2f'],
  ['cut', 'f32'],
  ['slot', 'f32'],
  ['quantization', 'f32'],
] as const)

/** Where the pass binds what it reads, in group 0: the uniform; the shafts' image; the last image's
 *  history and its sampler; the scene's depth. */
export const LIGHT_SHAFT_TEMPORAL_BINDING = {
  view: 0,
  source: 1,
  history: 2,
  sampler: 3,
  depth: 4,
} as const

/** The pass's entries. */
export const LIGHT_SHAFT_TEMPORAL_ENTRY = {
  vertex: 'fullscreen',
  temporal: 'temporalMain',
} as const

const B = LIGHT_SHAFT_TEMPORAL_BINDING

/** The tone weight of the luma `y` in the space the pass works in. */
const TONE = `fn toneOf(y:f32)->f32{return 1.0/(y*view.exposure.x+4.0);}`

/**
 * The temporal filter of a pixel of the shafts' image, in the order it is computed:
 * - WHERE: the pixel's viewport coordinate (its centre, held within the largest), the screen position
 *   of that, the shafts' coordinate it falls on, and the scene's depth at the pixel of the full-size
 *   depth that coordinate names;
 * - REPROJECTION: that depth and screen position through `clipToPrevClip`, the position the pixel
 *   was at in the last image, `historyScreen`; its distance from the pixel, `back`, in screen units;
 *   the pixel is off the last screen when `historyScreen` leaves the unit square;
 * - THE SPACE: the colour in the luma-chroma space, scaled so luma is `R + 2G + B`, the alpha as it
 *   is — what the weights and the contrast are tuned in;
 * - THE FILTER: the plus of five pixels around the nearest one (the coordinates held within the
 *   view), weighted by `plusA`, `plusB`, which sum to one;
 * - THE BOX: the plus's least and greatest per component, the alpha too;
 * - THE HISTORY: read bilinearly at the history screen position held to `historyMax`, its colour times
 *   the exposure ratio, then held within the box. A cut, or a position off the last screen, takes the
 *   filtered image in its place;
 * - THE SHARPENING: the filtered image goes toward the nearest pixel's by half the history's blur
 *   (the move back times the view size, twice the sum of its two axes, at most one) and by `1 / (1 + 128 · contrast)`, the box's
 *   luma range, saturated;
 * - THE BLEND: the history takes `1 - 1/lerp` of the output, the image `1/lerp`, each weighted by its
 *   tone weight (`toneOf`); a cut takes the image whole. An alpha above 0.995 is one. Back to colour,
 *   negative channels and NaNs to zero, held within the largest half float, the colour rounded
 *   stochastically in the output's format.
 */
const BODY = `
${LIGHT_SHAFT_TEMPORAL_VIEW.wgsl}
@group(0) @binding(${B.view}) var<uniform> view:LightShaftTemporalView;
@group(0) @binding(${B.source}) var source:texture_2d<f32>;
@group(0) @binding(${B.history}) var heldImage:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var linearSampler:sampler;
@group(0) @binding(${B.depth}) var sceneDepth:texture_depth_2d;
${TONE}
fn toPayload(c:vec4f)->vec4f{return vec4f(toYcocg(c.rgb)*4.0,c.a);}
fn fromPayload(c:vec4f)->vec4f{return vec4f(fromYcocg(c.rgb*0.25),c.a);}
fn shaftPixel(nearest:vec2f,offset:vec2i)->vec4f{
 let at=vec2i(nearest*vec2f(textureDimensions(source)))+offset;
 let rect=vec4i(view.inputRect);
 return toPayload(textureLoad(source,clamp(at,rect.xy,rect.zw),0));
}
@fragment fn ${LIGHT_SHAFT_TEMPORAL_ENTRY.temporal}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let viewportUv=min(position.xy*view.viewportUv.zw,view.viewportUv.xy);
 let screen=uvToNdc(viewportUv);
 let nearest=viewportUv*view.inputUv.xy+view.inputUv.zw;
 let depthSize=vec2i(textureDimensions(sceneDepth));
 let z=textureLoad(sceneDepth,clamp(vec2i(nearest*vec2f(depthSize)),vec2i(0),depthSize-vec2i(1)),0);
 let previousClip=view.clipToPrevClip*vec4f(screen,z,1.0);
 let back=screen-previousClip.xy/previousClip.w;
 let blurPixels=abs(back*view.outputSize.xy);
 let historyBlur=saturate(blurPixels.x*2.0+blurPixels.y*2.0);
 let historyScreen=screen-back;
 let offScreen=max(abs(historyScreen.x),abs(historyScreen.y))>=1.0;
 let n1=shaftPixel(nearest,vec2i(0,-1));
 let n3=shaftPixel(nearest,vec2i(-1,0));
 let n4=shaftPixel(nearest,vec2i(0,0));
 let n5=shaftPixel(nearest,vec2i(1,0));
 let n7=shaftPixel(nearest,vec2i(0,1));
 var filtered=n1*view.plusA.x+n3*view.plusA.y+n4*view.plusA.z+n5*view.plusA.w+n7*view.plusB.x;
 let boxMin=min(min(min(n1,n3),n4),min(n5,n7));
 let boxMax=max(max(max(n1,n3),n4),max(n5,n7));
 let historyUv=clamp(historyScreen,-view.historyMax,view.historyMax)*view.history.xy+view.history.zw;
 let raw=textureSampleLevel(heldImage,linearSampler,historyUv,0.0);
 var held=clamp(toPayload(vec4f(raw.rgb*view.exposure.y,raw.a)),boxMin,boxMax);
 let aliasing=saturate(saturate(historyBlur)*0.5+1.0/(1.0+(boxMax.x-boxMin.x)*128.0));
 filtered=mix(filtered,n4,aliasing);
 let cut=view.cut!=0.0;
 if(offScreen||cut){held=filtered;}
 let blend=select(${wgslF32(1 / LIGHT_SHAFT_TEMPORAL.lerp)},1.0,cut);
 let heldShare=(1.0-blend)*toneOf(held.x);
 let filteredShare=blend*toneOf(filtered.x);
 var mixed=(held*heldShare+filtered*filteredShare)/(heldShare+filteredShare);
 if(mixed.a>0.995){mixed.a=1.0;}
 let colour=min(vec4f(${wgslF32(HALF_MAX)}),-min(-fromPayload(mixed),vec4f(0.0)));
 let e=frameRandom(vec2i(position.xy),u32(view.slot)).x;
 return vec4f(ditherFloat(colour.rgb,e,view.quantization),colour.a);
}
`

/** The pass's whole shader text. */
export const lightShaftTemporalProgram = wgslProgram(BODY, [
  FULLSCREEN_VERTEX,
  YCOCG_WGSL,
  DITHER_WGSL,
  uvToNdc,
])
