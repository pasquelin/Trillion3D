import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { loadHeld } from '../../../math/src/wgsl/sampling.ts'
import { FULLSCREEN_VERTEX } from '../gpu/shader/fullscreenTriangle.ts'
import { DEPTH_WGSL } from '../post/taa/depthWgsl.ts'
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
// The modulation target is one texel of white where nothing modulated the scene, held to its extent.
fn throughAt(at:vec2i)->f32{return saturate(loadHeld(layers,at).a);}
fn visibleThrough(m:vec4f,through:f32)->f32{return select(backgroundVisibility(m.rgb)*through,1.0,m.a>0.5);}
@fragment fn scale(@builtin(position) pixel:vec4f)->Composed{
 let at=vec2i(pixel.xy);
 let m=loadHeld(modulation,at);
 return composed(vec4f(m.rgb,visibleThrough(m,throughAt(at))));
}
@fragment fn add(@builtin(position) pixel:vec4f)->Composed{
 let layer=textureLoad(layers,vec2i(pixel.xy),0);
 return composed(vec4f(layer.rgb,1.0-saturate(layer.a)));
}`

const COMPOSE_USES = [FULLSCREEN_VERTEX, backgroundVisibility, loadHeld]

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
 let m=loadHeld(modulation,at);
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

/** The bindings of the group of the smaller layers' composition (`Upsample`'s group): where they lie, their depth and the scene's. */
export const UPSAMPLE_BINDINGS = { view: 0, lowDepth: 1, fullDepth: 2 } as const

/** The declaration of the scene's depth the nearest depth neighbour compares with, in the group `group` of `UPSAMPLE_BINDINGS`. */
const fullDepthText = (group: number) =>
  `@group(${group}) @binding(${UPSAMPLE_BINDINGS.fullDepth}) var fullDepth:texture_depth_2d;`

/**
 * How a pass reads layers drawn into targets smaller than the image (`translucencyScale.ts`), from the textures `layers` and `modulation` and
 * the sampler `linearSampler` it declares, and the group `group` of `UPSAMPLE_BINDINGS` (the uniform `name`, of the struct `Upsample`, and
 * `lowDepth`). `tapsAt` gives where a pixel (its centre) reads them: its place in the smaller targets, bilinear, or — with the nearest
 * depth neighbour (`nearest`, comparing the scene's depth `fullDepth` at the texel `texel`, read only then) — the texel among the four
 * around it, held to the texels drawn, whose distance is nearest the scene's there, unless the four are all within a tenth of it, when
 * the pixel is read bilinear. `Upsample.place` holds the place of a pixel in the targets (its pixel times the ratio of the sizes over
 * their size) and the last texel centre drawn; `extent` the inverse of their size, the mode (the compose passes' choice of `nearest`)
 * and the farthest distance compared — 0 in the stand-in of a pass whose layers are not smaller; `depth` and `radius` the projection's
 * depth terms of the image (`putDepthTerms`), which `sceneDepthOf` (`DEPTH_WGSL`, reading them out of the uniform named `view`) turns
 * into distances along the view axis, perspective or orthographic: both depths are compared as distances, held to the farthest, so
 * that the relative test does not take the sky for a surface. A program that has a `view` of its own, which holds those terms
 * (the depth of field), gives its uniform another `name`.
 */
export const upsampleTaps = (group: number, name = 'upsample') =>
  wgslBlock(
    `UPSAMPLE_TAPS_${group}_${name}`,
    [DEPTH_WGSL],
    `
struct Upsample{place:vec4f,extent:vec4f,depth:vec4f,radius:vec4f,}
@group(${group}) @binding(${UPSAMPLE_BINDINGS.view}) var<uniform> ${name}:Upsample;
@group(${group}) @binding(${UPSAMPLE_BINDINGS.lowDepth}) var lowDepth:texture_depth_2d;
struct Taps{uv:vec2f,point:bool,}
fn distanceAt(depth:f32)->f32{return min(sceneDepthOf(depth),${name}.extent.w);}
fn lowDistance(texel:vec2i,last:vec2i)->f32{
 return distanceAt(textureLoad(lowDepth,clamp(texel,vec2i(0),last),0));
}
fn tapsAt(pixel:vec2f,nearest:bool,fullDepth:texture_depth_2d,texel:vec2i)->Taps{
 let least=0.5*${name}.extent.xy;
 let uv=clamp(pixel*${name}.place.xy,least,${name}.place.zw);
 if(!nearest){return Taps(uv,false);}
 let size=vec2f(textureDimensions(lowDepth));
 let last=vec2i(floor(${name}.place.zw*size));
 let base=vec2i(floor(uv*size-vec2f(0.5)));
 let full=distanceAt(textureLoad(fullDepth,texel,0));
 var near=array<f32,4>(lowDistance(base,last),lowDistance(base+vec2i(1,0),last),lowDistance(base+vec2i(0,1),last),lowDistance(base+vec2i(1,1),last));
 var best=1e8;
 var pick=base;
 var close=true;
 for(var k=0;k<4;k++){
  let at=base+vec2i(k&1,k>>1);
  let gap=abs(near[k]-full);
  if(gap<best){best=gap;pick=at;}
  close=close&&gap/full<0.1;
 }
 if(close){return Taps(uv,false);}
 return Taps(clamp((vec2f(clamp(pick,vec2i(0),last))+vec2f(0.5))/size,least,${name}.place.zw),true);
}
fn layersTap(taps:Taps)->vec4f{
 if(taps.point){return textureLoad(layers,vec2i(taps.uv*vec2f(textureDimensions(layers))),0);}
 return textureSampleLevel(layers,linearSampler,taps.uv,0.0);
}
fn modulationTap(taps:Taps)->vec4f{
 if(taps.point){return textureLoad(modulation,vec2i(taps.uv*vec2f(textureDimensions(modulation))),0);}
 return textureSampleLevel(modulation,linearSampler,taps.uv,0.0);
}`,
  )

/** The composition of layers drawn into targets smaller than the image: the same draws (`scale`, `add`, `composeDual`), the layers and the
 *  modulation read where `tapsAt` says, the nearest depth neighbour chosen by the mode (1, layers at half the image's size). */
const UPSAMPLE_TEXT = `
@group(0) @binding(${LAYERS_BINDINGS.layers}) var layers:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.modulation}) var modulation:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.sampler}) var linearSampler:sampler;
${fullDepthText(1)}
struct Composed{@location(0) first:vec4f,@location(1) second:vec4f,}
fn composed(value:vec4f)->Composed{return Composed(value,value);}
fn composeTaps(pixel:vec2f)->Taps{
 return tapsAt(pixel,view.extent.z>=0.5,fullDepth,vec2i(pixel));
}
fn visibleThrough(m:vec4f,through:f32)->f32{return select(backgroundVisibility(m.rgb)*through,1.0,m.a>0.5);}
@fragment fn scale(@builtin(position) pixel:vec4f)->Composed{
 let taps=composeTaps(pixel.xy);
 let m=modulationTap(taps);
 return composed(vec4f(m.rgb,visibleThrough(m,saturate(layersTap(taps).a))));
}
@fragment fn add(@builtin(position) pixel:vec4f)->Composed{
 let layer=layersTap(composeTaps(pixel.xy));
 return composed(vec4f(layer.rgb,1.0-saturate(layer.a)));
}`

const UPSAMPLE_USES = [FULLSCREEN_VERTEX, backgroundVisibility, upsampleTaps(1, 'view')]

/** The smaller layers' composition on a device without dual-source blending: `scale` then `add`. */
export const UPSAMPLE_WGSL = wgslProgram(UPSAMPLE_TEXT, UPSAMPLE_USES)

/** The same on a device granted `dual-source-blending`, and the single draw on one target (`composeDual`). */
export const UPSAMPLE_DUAL_WGSL = wgslProgram(
  `enable dual_source_blending;${UPSAMPLE_TEXT}
struct ComposedDual{@location(0) @blend_src(0) light:vec4f,@location(0) @blend_src(1) factor:vec4f,}
@fragment fn composeDual(@builtin(position) pixel:vec4f)->ComposedDual{
 let taps=composeTaps(pixel.xy);
 let m=modulationTap(taps);
 let layer=layersTap(taps);
 let through=saturate(layer.a);
 return ComposedDual(vec4f(layer.rgb,0.0),vec4f(m.rgb*through,visibleThrough(m,through)));
}`,
  UPSAMPLE_USES,
)

/** The late composition of layers drawn into targets smaller than the render size (`translucencyScale.ts`): the same, the layers and
 *  the modulation read where `tapsAt` says (the group 2 of `UPSAMPLE_BINDINGS`) at the render pixel under the image's: the nearest
 *  depth neighbour at half the render size, the mode permitting, as the compositions onto the lit image do. Here `LateView.scale.xy`
 *  holds the render size over the image's, and `image` the image's inverse size only. */
export const LATE_UPSAMPLE_WGSL = wgslProgram(
  `
@group(0) @binding(${LAYERS_BINDINGS.layers}) var layers:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.modulation}) var modulation:texture_2d<f32>;
@group(0) @binding(${LAYERS_BINDINGS.sampler}) var linearSampler:sampler;
struct LateView{image:vec4f,scale:vec4f,}
@group(1) @binding(${LATE_BINDINGS.scene}) var scene:texture_2d<f32>;
@group(1) @binding(${LATE_BINDINGS.view}) var<uniform> lateView:LateView;
${fullDepthText(2)}
@fragment fn composeLate(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let render=pixel.xy*lateView.scale.xy;
 let taps=tapsAt(render,view.extent.z>=0.5,fullDepth,vec2i(render));
 return layersOver(textureLoad(scene,vec2i(pixel.xy),0),layersTap(taps),modulationTap(taps));
}`,
  [FULLSCREEN_VERTEX, layersOver, upsampleTaps(2, 'view')],
)
