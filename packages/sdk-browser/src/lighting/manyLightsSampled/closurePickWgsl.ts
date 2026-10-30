/**
 * THE CLOSURES OF A PIXEL IN THE SAMPLED LIGHTING, for a view whose pixels hold several (`ContractKey.closures`). Two ways to light them, as the
 * reference's two, the setting `stochasticClosureLighting` (off) picking one:
 *
 * - summed: every closure is weighed, shaded and demodulated, and the sums are weighed by the closure's weight (`closureWeightAt`: its coverage and the
 *   luminance weight the tops leave it, the reference's `LuminanceWeight`): the light of the pixel is the sum of the closures' weighted lights, the colours
 *   the light is demodulated by (and put back by, after the filters) the sums of the closures' weighted colours;
 * - stochastic: one closure is picked for the pixel, each equally likely, by the blue noise of the pixel and the image
 *   (uniform sampling: the pick is `count · noise` held to the last closure, its chance `1 / count`); the pixel is weighed, shaded and demodulated as that
 *   closure alone, its light multiplied by the closure's weight and divided by the chance of the pick, its colours by
 *   the weight.
 *
 * A pixel of one closure — or a record that holds one — is the pixel as ever. The pick is a function of the pixel and the image, so every kernel that
 * reads the pixel (the sampling, the shading, the spatial filter) finds the same closure.
 */
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { SURFACE_F0_WGSL, specularOfFlags } from '../../materials/surface/surfaceSpecular.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { MODEL_SWITCH } from '../../materials/surface/pixelModel.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../direct/environmentBrdfWgsl.ts'
import {
  CLOSURE_READ_WGSL,
  LIGHTING_ONLY_BRIGHTNESS,
  VIEW_BINDING_WGSL,
} from '../deferred/litSurfaceWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'

/** The word of the uniform (`denoiseU.y`) that says the sampled lighting picks one closure a pixel. */
export const STOCHASTIC_CLOSURES_WORD = 65

/**
 * The pick of the pixel's closures: how many it holds (the steps of its offsets word that are not zero, `closureTilesWgsl.ts`; one where the
 * record holds one), the closure the pick finds and its chance, the weight the pixel's colours and light are scaled by (`pickedScale`), and the layers of the
 * picked closure's base and normal. It binds the pixel's layers and the blue noise but not the view, so that the traces of the samples' rays, which have
 * the view in another group, read the closure they offset their rays along.
 */
export const CLOSURE_PICK_WGSL = wgslBlock(
  'SAMPLED_CLOSURE_PICK_WGSL',
  [CLOSURE_READ_WGSL, SAMPLED_PARAMS_WGSL, blueNoiseWgsl(0, SAMPLED_BINDINGS.blue)],
  `fn stochasticClosures()->bool{return params.denoiseU.y!=0u;}
/** What a pixel's closures are, worked out once for the pixel last asked (a kernel asks it for each light, each sample and each neighbour): the closures it has, the one it is lit as and its chance. */
var<private> settledAt=vec2i(-1);
var<private> settledCount=1u;
var<private> settledPick=0u;
fn settlePixel(coord:vec2i){
 if(all(coord==settledAt)){return;}
 settledAt=coord;
 settledCount=closureCountAt(coord);
 settledPick=select(0u,min(u32(f32(settledCount)*blueNoiseScalar(vec2u(coord),params.frame)),settledCount-1u),settledCount>=2u&&stochasticClosures());
}
/** The weight of each closure of the pixel last asked for its weights (\`closureWeightAt\`), read once for it. */
var<private> weighedAt=vec2i(-1);
var<private> weighed:array<f32,${MAX_CLOSURES}>;
fn pixelWeight(coord:vec2i,closure:u32)->f32{
 if(!all(coord==weighedAt)){
  settlePixel(coord);
  weighedAt=coord;
  for(var k=0u;k<settledCount;k++){weighed[k]=closureWeightAt(coord,k);}
 }
 return weighed[closure];
}
fn pixelClosures(coord:vec2i)->u32{settlePixel(coord);return settledCount;}
/** The closure the pixel is lit as: the first, or where the sampled lighting picks one, the pick of the pixel's blue noise in this image. */
fn pickedClosure(coord:vec2i)->u32{settlePixel(coord);return settledPick;}
/** The chance of the pick: one over the pixel's closures, one where the pixel is lit as it is. */
fn pickedPdf(coord:vec2i)->f32{
 settlePixel(coord);
 return select(1.0,1.0/f32(settledCount),settledCount>1u&&stochasticClosures());
}
/** What the picked closure's colours and light are scaled by: its weight, one where the pixel is lit as it is. */
fn pickedScale(coord:vec2i)->f32{
 settlePixel(coord);
 if(settledCount<2u||!stochasticClosures()){return 1.0;}
 return pixelWeight(coord,settledPick);
}
fn pickedBaseLayer(coord:vec2i)->u32{
 let closure=pickedClosure(coord);
 return select(${SURFACE_COLOUR_LAYERS.base}u,closureColourLayer(closure),closure>0u);
}
fn pickedNormalLayer(coord:vec2i)->u32{
 let closure=pickedClosure(coord);
 return select(${SURFACE_COLOUR_LAYERS.normal}u,closureColourLayer(closure)+1u,closure>0u);
}
`,
)

/** The pick, the view, and the slice of any closure. `closurePixel` is the pixel the sampling weighs, set by `closureStatements`. */
export const SAMPLED_CLOSURE_WGSL = wgslBlock(
  'SAMPLED_CLOSURE_WGSL',
  [CLOSURE_PICK_WGSL, VIEW_BINDING_WGSL, SURFACE_F0_WGSL, specularOfFlags],
  `var<private> closurePixel:vec2i=vec2i(0);
/** The specular of closure closure of the pixel, its own (the lighting view's none, as the first closure's). */
fn closureSpecularAt(coord:vec2i,closure:u32)->f32{
 return select(specularOfFlags(closureFlagsAt(coord,closure)),0.0,u32(view.views.x)==3u);
}
/** What a closure past the first is lit from: its base colour and metalness, its normal and roughness, the unit normal and the colour (the lighting view's, a fixed grey). */
struct ClosureSlice{base:vec4f,normal:vec4f,N:vec3f,albedo:vec3f}
fn closureSlice(coord:vec2i,closure:u32)->ClosureSlice{
 let slice=closureColourLayer(closure);
 var base=textureLoad(colours,coord,slice,0);
 let normal=textureLoad(colours,coord,slice+1u,0);
 let lightingOnly=u32(view.views.x)==3u;
 if(lightingOnly){base.a=0.0;}
 return ClosureSlice(base,normal,normalize(normal.xyz),select(base.rgb,vec3f(${LIGHTING_ONLY_BRIGHTNESS}),lightingOnly));
}`,
)

/**
 * The model and lobes of closure `closure` of the pixel set for the light terms (`enterClosure`), as `closureLoop` does for the lit passes: its specular, and, where the
 * program holds the lobes (`lobes`), its anisotropy, its coat and its cloth decoded from its own texel (the first closure's from the lobes target), none where its flags carry no
 * lobe. The pixel's shading model is the graph's one for the pixel and stays. A pass that lights a closure past the first calls it, and again for the first closure when it is done.
 */
export const closureStateWgsl = (lobes: boolean) =>
  wgslBlock(
    `SAMPLED_CLOSURE_STATE_WGSL(${lobes})`,
    [SAMPLED_CLOSURE_WGSL],
    `fn enterClosure(coord:vec2i,closure:u32,N:vec3f,V:vec3f){
 surfaceSpecular=closureSpecularAt(coord,closure);${
   lobes
     ? `
 roughDiffuse=(u32(view.views.w)&${MODEL_SWITCH.roughDiffuse}u)!=0u;
 lobes.on=false;
 if((closureFlagsAt(coord,closure)&${PHYSICAL_SURFACE_FLAG}u)!=0u){
  let layer=select(${SURFACE_COLOUR_LAYERS.base}u,closureColourLayer(closure),closure>0u);
  let base=textureLoad(colours,coord,layer,0);
  let normal=textureLoad(colours,coord,layer+1u,0);
  let texel=select(textureLoad(physicalLobes,coord),closureLobesTexel(coord,closure),closure>0u);
  lobesAt(texel,1.0,N,V,normal.a);
  setLobeBase(base.rgb,select(base.a,0.0,u32(view.views.x)==3u),normal.a);
 }`
     : ''
 }
}`,
  )

/**
 * The colours a pixel's light is demodulated by before the filters and put back by after them: the diffuse colour and the specular share of the
 * environment, of the pixel's one closure and scaled by its weight where the pick is stochastic, else summed over the closures weighed by their weights.
 * `rgb`, `metal`, `rough` and `N` are the first closure's (or the picked one's); `albedoView` says the colour a closure past the first is read in is the
 * lighting view's grey (the shading's), not its base colour (the spatial filter's).
 */
export const CLOSURE_TONE_WGSL = wgslBlock(
  'SAMPLED_CLOSURE_TONE_WGSL',
  [SAMPLED_CLOSURE_WGSL, SURFACE_F0_WGSL, ENVIRONMENT_BRDF_WGSL],
  `struct ClosureTone{diffuse:vec3f,environment:vec3f}
fn closureToneOf(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->ClosureTone{
 let f0=surfaceF0(rgb,metal);
 return ClosureTone(rgb*(1.0-metal),environmentBrdf(f0,saturate(50.0*f0.g),rough,saturate(dot(N,V))));
}
fn closureTone(coord:vec2i,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,albedoView:bool)->ClosureTone{
 let own=closureToneOf(rgb,metal,rough,N,V);
 let count=pixelClosures(coord);
 if(count<2u){return own;}
 if(stochasticClosures()){
  let w=pickedScale(coord);
  return ClosureTone(own.diffuse*w,own.environment*w);
 }
 let first=pixelWeight(coord,0u);
 var sum=ClosureTone(own.diffuse*first,own.environment*first);
 for(var k=1u;k<count;k++){
  let w=pixelWeight(coord,k);
  let s=closureSlice(coord,k);
  let own0=surfaceSpecular;
  surfaceSpecular=closureSpecularAt(coord,k);
  let part=closureToneOf(select(s.base.rgb,s.albedo,albedoView),s.base.a,s.normal.a,s.N,V);
  surfaceSpecular=own0;
  sum=ClosureTone(sum.diffuse+part.diffuse*w,sum.environment+part.environment*w);
 }
 return sum;
}`,
)

/** The loads a lit pixel reads its first closure's colours with (`litPixelStatements`), and what a pass that lights the picked closure reads them with. */
const BASE_LOAD = ` var base=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.base},0);`
const FLAGS_LOAD = ` let surfaceFlag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;`
/** The read of the lobes of the pixel's first closure, and of the picked closure's (its own texel past the first). */
const LOBES_READ = 'readLobes(coord,N,V,normal.a);'
const PICKED_LOBES_READ =
  'lobesAt(select(textureLoad(physicalLobes,coord),closureLobesTexel(coord,pickedClosure(coord)),pickedClosure(coord)>0u),1.0,N,V,normal.a);'
const NORMAL_LOAD = ` let normal=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.normal},0);`

/**
 * The statements of a lit pixel (`litPixelStatements`) of a view that holds several closures: the pixel's colour and normal read from the picked closure's
 * slice (the first closure's where the lighting is not stochastic or the pixel holds one), and `closurePixel` set for the sums.
 */
export function closureStatements(statements: string) {
  if (
    !statements.includes(BASE_LOAD) ||
    !statements.includes(NORMAL_LOAD) ||
    !statements.includes(FLAGS_LOAD)
  )
    throw new Error('LIT_PIXEL_COLOUR_LOADS_MOVED')
  return `${statements
    .replace(FLAGS_LOAD, ' let surfaceFlag=closureFlagsAt(coord,pickedClosure(coord));')
    .replace(LOBES_READ, PICKED_LOBES_READ)
    .replace(BASE_LOAD, ' var base=textureLoad(colours,coord,pickedBaseLayer(coord),0);')
    .replace(NORMAL_LOAD, ' let normal=textureLoad(colours,coord,pickedNormalLayer(coord),0);')}
 closurePixel=coord;`
}
