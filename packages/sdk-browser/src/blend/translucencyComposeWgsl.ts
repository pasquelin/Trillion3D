import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { FULLSCREEN_VERTEX } from '../gpu/shader/fullscreenTriangle.ts'
import { LAYERS_BINDINGS } from './translucencyLayers.ts'

/** How much of the background the modulation leaves visible: the mean of its three channels. */
const backgroundVisibility = wgslFn(
  'backgroundVisibility',
  [],
  'fn backgroundVisibility(modulation:vec3f)->f32{return dot(modulation,vec3f(1.0/3.0));}',
)

/**
 * A texel of the image with the translucency of the layers over it: the scene's colour times the
 * modulation and the transmittance, plus the light the layers add (`layers`: the light in red, green
 * and blue, the transmittance in alpha); the image's alpha, where it carries one, is the scene's
 * times the transmittance and times the background the modulation leaves visible — or the scene's
 * as it is where the modulation's alpha is 1, the alpha holdout laying its own (`holdout.ts`). The
 * depth of field's recombine composes with it as the composition's draws do.
 */
export const layersOver = wgslFn(
  'layersOver',
  [backgroundVisibility],
  `fn layersOver(scene:vec4f,layers:vec4f,modulation:vec4f)->vec4f{
 let through=saturate(layers.a);
 return vec4f(layers.rgb+scene.rgb*modulation.rgb*through,select(scene.a*through*backgroundVisibility(modulation.rgb),scene.a,modulation.a>0.5));
}`,
)

/** The composition's draws: the scene times the modulation (`scale`), the light laid over it (`add`),
 *  on `count` targets; the image's alpha, where it carries one, follows in the first draw alone. */
const COMPOSE_TEXT = `
@group(0) @binding(${LAYERS_BINDINGS.layers}) var layers:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.modulation}) var modulation:texture_2d<f32>;
struct Composed{@location(0) first:vec4f,@location(1) second:vec4f,}
fn composed(value:vec4f)->Composed{return Composed(value,value);}
// The modulation target is one texel of white where nothing modulated the scene.
fn modulationAt(at:vec2i)->vec4f{return textureLoad(modulation,min(at,vec2i(textureDimensions(modulation))-vec2i(1)),0);}
fn throughAt(at:vec2i)->f32{return saturate(textureLoad(layers,min(at,vec2i(textureDimensions(layers))-vec2i(1)),0).a);}
fn visibleThrough(m:vec4f,through:f32)->f32{return select(backgroundVisibility(m.rgb)*through,1.0,m.a>0.5);}
@fragment fn scale(@builtin(position) pixel:vec4f)->Composed{
 let at=vec2i(pixel.xy);
 let m=modulationAt(at);
 return composed(vec4f(m.rgb,visibleThrough(m,throughAt(at))));
}
@fragment fn add(@builtin(position) pixel:vec4f)->Composed{
 let layer=textureLoad(layers,vec2i(pixel.xy),0);
 return composed(vec4f(layer.rgb,1.0-saturate(layer.a)));
}`

const COMPOSE_USES = [FULLSCREEN_VERTEX, backgroundVisibility]

/** The composition on a device without dual-source blending: `scale` then `add`. */
export const COMPOSE_WGSL = wgslProgram(COMPOSE_TEXT, COMPOSE_USES)

/** The composition on a device granted `dual-source-blending`: the same, and a single draw on one
 *  target (`composeDual`) — the light the layers add as the first source, the scene's factor as the
 *  second: the modulation times the transmittance, and in the alpha the background the modulation
 *  leaves visible times it, or one where the modulation's alpha is 1 (`layersOver`). A module of its
 *  own: the `blend_src` outputs ask the directive, which a device without the feature refuses. */
export const COMPOSE_DUAL_WGSL = wgslProgram(
  `enable dual_source_blending;${COMPOSE_TEXT}
struct ComposedDual{@location(0) @blend_src(0) light:vec4f,@location(0) @blend_src(1) factor:vec4f,}
@fragment fn composeDual(@builtin(position) pixel:vec4f)->ComposedDual{
 let at=vec2i(pixel.xy);
 let m=modulationAt(at);
 let through=throughAt(at);
 return ComposedDual(vec4f(textureLoad(layers,at,0).rgb,0.0),vec4f(m.rgb*through,visibleThrough(m,through)));
}`,
  COMPOSE_USES,
)

/** The bindings of the late composition's second group: the image the layers go over, and where they
 *  lie in it (`LateView`). */
export const LATE_BINDINGS = { scene: 0, view: 1 } as const

/** The late layers composed over an image into a new one: the image's colour, then `layersOver`. The
 *  layers were drawn at the render size, the image may be at the display's: they are read through the
 *  bilinear sampler at the pixel's place. `LateView.image` holds the image's size and its inverse,
 *  `scale` the layers' texels over the render size's and, past it, the last texel centre drawn. */
export const LATE_WGSL = wgslProgram(
  `
@group(0) @binding(${LAYERS_BINDINGS.layers}) var layers:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.modulation}) var modulation:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.sampler}) var linearSampler:sampler;
struct LateView{image:vec4f,scale:vec4f,}
@group(1) @binding(${LATE_BINDINGS.scene}) var scene:texture_2d<f32>;
@group(1) @binding(${LATE_BINDINGS.view}) var<uniform> lateView:LateView;
@fragment fn composeLate(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=min(pixel.xy*lateView.image.zw*lateView.scale.xy,lateView.scale.zw);
 let light=textureSampleLevel(layers,linearSampler,uv,0.0);
 let m=textureSampleLevel(modulation,linearSampler,uv,0.0);
 return layersOver(textureLoad(scene,vec2i(pixel.xy),0),light,m);
}`,
  [FULLSCREEN_VERTEX, layersOver],
)
