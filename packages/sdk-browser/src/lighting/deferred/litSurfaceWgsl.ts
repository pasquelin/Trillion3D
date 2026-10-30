/**
 * WHAT EVERY PASS THAT LIGHTS A SURFACE READS OF IT, written once: the declarations of the
 * surface's bindings — each pass lists the ones it reads, and its layout holds those alone
 * (`layoutEntries.ts`) — and the statements that read a lit pixel (`litPixelStatements`): its flags, its
 * colour, normal and depth, the point and the directions it is seen from, the state the light terms
 * read it through (`surfaceModel`, `surfaceSpecular`, `surfaceChannels`, `thinSubsurface`, the lobes).
 * The sun's pass, the local lights' and the indirect light's read the same pixel the same way, so
 * their terms are the parts of one sum.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  COVERAGE_MAX,
  COVERAGE_PRESENT,
  LUMINANCE_MAX,
  LUMINANCE_SHIFT,
  SURFACE_CLOSURES,
  SURFACE_COLOUR_LAYERS,
  SURFACE_WORDS,
  SURFACE_WORD_LAYERS,
  closureCountOf,
  closureFlagsLayerOf,
  closureLobesLayerOf,
  closuresHeldOf,
} from '../../materials/surface/surfaceOutputs.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import {
  MODEL_SWITCH,
  PIXEL_MODEL,
  scattersPixelModel,
} from '../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG, SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../materials/surface/surfaceEmission.ts'
import { specularOfFlags } from '../../materials/surface/surfaceSpecular.ts'
import { SURFACE_CHANNELS_WGSL, channelsOfFlags } from '../../materials/surface/surfaceChannels.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { readLobesStatement } from '../direct/lobesWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from '../direct/shadingModelState.ts'
import { SSS_LIT_WGSL } from '../subsurface/litHook.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { PIXEL_TILE_CLASS_WGSL, TILE_CLASS, type TileClass } from './tileClass.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from './worldAtWgsl.ts'

/** The diffuse colour the lighting view shows every surface with, as WGSL text: the reference's default brightness of a lighting-only view, 0.3. */
export const LIGHTING_ONLY_BRIGHTNESS = '0.3'

/** The surface's colour layers (the base and metalness, the normal and roughness), by load. */
export const COLOURS_BINDING_WGSL = wgslBlock(
  'COLOURS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.colours}) var colours:texture_2d_array<f32>;`,
)
/** The emission and the material's occlusion, read where the flags say they hold something. */
export const EMISSIVE_BINDING_WGSL = wgslBlock(
  'EMISSIVE_BINDING_WGSL',
  [SURFACE_EMISSIVE_AO_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.emissiveAo}) var emissiveAo:texture_2d<f32>;`,
)
/** The surface's word layers: the flags. */
export const WORDS_BINDING_WGSL = wgslBlock(
  'WORDS_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.words}) var words:texture_2d_array<u32>;`,
)
/** The scene's depth. */
export const DEPTH_BINDING_WGSL = wgslBlock(
  'DEPTH_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.depth}) var depth:texture_depth_2d;`,
)
/** What the contact shadows' rays read of the scene (`../contactShadow/contactShadowWgsl.ts`): its depth and the flags of
 *  the surface a ray hits, by load at a pixel the ray already holds to the viewport (`contactPixel`; the textures are the
 *  drawn size, the clamp of `hizPixel` would change nothing). Listed by the passes that cast the rays. */
export const DEFERRED_CONTACT_SCENE_WGSL = wgslBlock(
  'DEFERRED_CONTACT_SCENE_WGSL',
  [WORDS_BINDING_WGSL, DEPTH_BINDING_WGSL],
  `fn contactSceneFlags(pixel:vec2i)->u32{return textureLoad(words,pixel,${SURFACE_WORDS.flags},0).r;}
fn contactSceneDepth(pixel:vec2i)->f32{return textureLoad(depth,pixel,0);}`,
)
/** The view's uniform, the one every pass of the lighting reads (`VIEW_WGSL`). */
export const VIEW_BINDING_WGSL = wgslBlock(
  'VIEW_BINDING_WGSL',
  [VIEW_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.view}) var<uniform> view:View;`,
)
/** The thin transmission colour of the surface, by load. */
export const SUBSURFACE_BINDING_WGSL = wgslBlock(
  'SUBSURFACE_BINDING_WGSL',
  [],
  SUBSURFACE_TARGET.wgsl,
)

/** The pre-exposure of the lit image, the view's (`view.preExposure.x`): what every light a pass
 *  writes is multiplied by. */
export const VIEW_PRE_EXPOSED_WGSL = preExposedWgsl('view.preExposure.x')

/** A light's strength under the view's exposure (`lightStrength`): the pre-exposure the light is written multiplied by times the
 *  scale the composition applies (`view.preExposure.xy`), the exposure of the image. */
const VIEW_LIGHT_STRENGTH_WGSL = lightStrengthWgsl('view.preExposure.x*view.preExposure.y')

/**
 * What the pixels of a class of tile may need (`CLASS_CUTS`), and so what the programs of the class
 * hold: the diffuse and toon models (`models`), the thin transmission (`thin`: read from its target,
 * and lit through the surface from either side), the anisotropic and clear-coat lobes (`lobes`: read
 * from their target, and run by the light terms).
 */
export interface ClassCut {
  models: boolean
  thin: boolean
  lobes: boolean
}

/** What a pass reads of a lit pixel: its class's cut, and whether it unpacks the pixel's lighting channels (`channels`: the
 *  program's lights test them, `ContractKey.channelless`; a pass that lights no pixel by a light's term reads none). */
export interface LitPixelCut extends ClassCut {
  channels: boolean
  /** Whether the pass writes the toon data (`ContractKey.toonData`): the toon diffuse of a toon pixel is left unramped to the pass after the lights. */
  toonData?: boolean
  /** Whether the pass lights every closure of a pixel and sums them by coverage (`ContractKey.closures`, `closureTail`): with the toon data too, the toon light of each closure added to the data by its coverage, the ramp applied once to the pixel's sum. */
  closures?: boolean
}

/** The cut of each class: a tile is of the class of its most demanding pixel (`pixelTileClass`), so
 *  each class holds what the ones below it do. */
export const CLASS_CUTS: Record<TileClass, ClassCut> = {
  [TILE_CLASS.simple]: { models: false, thin: false, lobes: false },
  [TILE_CLASS.single]: { models: true, thin: true, lobes: false },
  [TILE_CLASS.complex]: { models: true, thin: true, lobes: true },
}

/** The cut of a pass that lights its pixels by a light's term, for the class `tileClass` under the key `key`: the class's, and the
 *  lighting channels where the program's lights test them. */
export const litCutOf = (
  tileClass: TileClass,
  key: { readonly channelless: boolean; readonly toonData?: boolean; readonly closures?: boolean },
): LitPixelCut => ({
  ...CLASS_CUTS[tileClass],
  channels: !key.channelless,
  toonData: !!key.toonData && CLASS_CUTS[tileClass].models,
  ...(key.closures ? { closures: true } : {}),
})

/**
 * The declarations the statements of a lit pixel (`litPixelStatements`) name: the point of a pixel
 * (`worldAt`), the emission it holds, the specular and the coat its flags carry, the class of a
 * pixel by its flags. The surface bindings and the thin transmission's are the pass's own.
 */
export const LIT_PIXEL_WGSL = wgslBlock(
  'LIT_PIXEL_WGSL',
  [
    WORLD_AT_WGSL,
    COLOURS_BINDING_WGSL,
    EMISSIVE_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    DEPTH_BINDING_WGSL,
    VIEW_BINDING_WGSL,
    PIXEL_TILE_CLASS_WGSL,
    specularOfFlags,
    VIEW_PRE_EXPOSED_WGSL,
    VIEW_LIGHT_STRENGTH_WGSL,
    SHADING_MODEL_STATE_WGSL,
    SSS_LIT_WGSL,
  ],
  `
/** The view's switches of the shading models and of the lit image (views.w), read once for the pixel's statements and the light's term. */
fn modelSwitchBits()->u32{return u32(view.views.w);}
/** A light's term in the lit image: the light multiplied by the pre-exposure, not held (the base pass holds the emission
 *  alone, colourPassWgsl.ts); its alpha the pre-exposed luminance of the light the subsurface scattering spreads
 *  (scatterAdd), where the pass that spreads it runs (sssLitResult). */
fn lightOut(rgb:vec3f)->vec4f{
 let bits=modelSwitchBits();
 return sssLitResult(preExposed(rgb),scatterLuma*view.preExposure.x,sssLitPostprocess(bits),sssLitCheckerboard(bits));
}`,
)

/**
 * WHAT A PASS READS OF A PIXEL'S CLOSURES, for a view whose pixels hold several (`ContractKey.closures`): the closures the record holds,
 * the colour layer its first closure past the first sits at, and a closure's coverage — all read off the sizes of the two targets, which
 * the record (`SURFACE_CLOSURES`) lays out as the first closure's layers, then two colour layers a closure after them, and in the words the
 * flags, a coverage per closure and the offsets. The coverage of the first closure is one where its word was never written: a pixel of a
 * material of one closure.
 */
export const CLOSURE_READ_WGSL = wgslBlock(
  'CLOSURE_READ_WGSL',
  [
    COLOURS_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    closuresHeldOf,
    closureCountOf,
    closureFlagsLayerOf,
    closureLobesLayerOf,
  ],
  `
fn closuresHeld()->u32{return closuresHeldOf(textureNumLayers(words));}
/** The closures the pixel itself has, by its offsets word (the first, and one for each step that is not zero), as the reference loops the BSDF count of the pixel: one where the record holds one. */
fn closureCountAt(coord:vec2i)->u32{
 let held=closuresHeld();
 if(held<2u){return 1u;}
 return closureCountOf(textureLoad(words,coord,i32(textureNumLayers(words))-1,0).x,held);
}
/** The flags of closure: the pixel's for the first, its own (the pixel's with its specular and lobe mark) past it. */
fn closureFlagsAt(coord:vec2i,closure:u32)->u32{
 return textureLoad(words,coord,select(${SURFACE_WORDS.flags}u,closureFlagsLayerOf(closuresHeld(),closure),closure>0u),0).r;
}
/** The lobes texel of closure past the first, in the four word layers after its flags. */
fn closureLobesTexel(coord:vec2i,closure:u32)->vec4u{
 let at=closureLobesLayerOf(closuresHeld(),closure);
 return vec4u(textureLoad(words,coord,at,0).r,textureLoad(words,coord,at+1u,0).r,textureLoad(words,coord,at+2u,0).r,textureLoad(words,coord,at+3u,0).r);
}
fn closureColourLayer(closure:u32)->u32{return textureNumLayers(colours)-${SURFACE_CLOSURES.colours}u*(closuresHeld()-closure);}
fn closureCoverageAt(coord:vec2i,closure:u32)->f32{
 let word=textureLoad(words,coord,${SURFACE_WORD_LAYERS}u+closure,0).r;
 if(closure==0u&&word==0u){return 1.0;}
 return select(0.0,f32(word&${COVERAGE_MAX}u)/${COVERAGE_MAX}.0,(word&${COVERAGE_PRESENT}u)!=0u);
}
/** What a closure's light is weighed by: its coverage, and the luminance weight the tops above it leave it (one where none covers it): the reference's LuminanceWeight. */
fn closureWeightAt(coord:vec2i,closure:u32)->f32{
 let word=textureLoad(words,coord,${SURFACE_WORD_LAYERS}u+closure,0).r;
 return closureCoverageAt(coord,closure)*select(f32(word>>${LUMINANCE_SHIFT}u)/${LUMINANCE_MAX}.0,1.0,closure==0u&&word==0u);
}`,
)

/**
 * The tail of a pass's fragment, where it returns the light `light` (an expression in the pixel's `albedo`, `base`, `normal` and `N`): for
 * one closure, `single` — the pass's own return, its text unchanged —; for a view whose pixels hold several, the light of every closure
 * the record holds, summed by the closure's coverage, as the reference loops the closures of a pixel and weighs each one's light
 * (the reference's deferred lighting of the closures, its luminance weight). The first closure is the pixel's read as ever (its model, its
 * lobes); a closure past it is read from its slice — base colour and metalness, normal and roughness — under the same view of the lit
 * image. Every closure is lit whatever its coverage, a zero one adding nothing, so the loop stays uniform for the texture reads of the light.
 */
export const closureTail = (
  cut: Pick<LitPixelCut, 'closures' | 'lobes' | 'toonData'>,
  light: string,
  single: (light: string) => string,
) =>
  cut.closures ? closureLoop((add) => add(light), '', cut.lobes, !!cut.toonData) : single(light)

/**
 * What the loop of `closureLoop` reads of a closure past the first beside its colours, the model and the lobes it keeps of its own (`SurfaceBuffer.words`, the layers
 * `closureFlagsLayerOf` names, the resolve writes them): its specular, and, where the program holds the lobes (`lobes`), its anisotropy, its coat and its cloth, decoded as a
 * pixel's are (`lobesAt`) from its own texel, none where its flags carry no lobe. The pixel's shading model and what the model needs beyond the surface (the thin
 * transmission, the toon data) are the graph's one output for the pixel, the first closure's.
 */
const closureModel = (lobes: boolean) => `   let closureFlags=closureFlagsAt(coord,closure);
   surfaceSpecular=select(specularOfFlags(closureFlags),0.0,lightView==3u);${
     lobes
       ? `
   roughDiffuse=(modelBits&${MODEL_SWITCH.roughDiffuse}u)!=0u;
   lobes.on=false;
   if((closureFlags&${PHYSICAL_SURFACE_FLAG}u)!=0u){
    lobesAt(closureLobesTexel(coord,closure),1.0,N,V,normal.a);
    setLobeBase(base.rgb,base.a,normal.a);
   }`
       : ''
   }
`

/**
 * The loop of `closureTail` over a body of several statements: `body` is handed the statement that adds the light it computes, weighed by the
 * closure's coverage, to the sum, and is written once for the first closure and once for each closure past it, whose slice shadows the
 * pixel's `base`, `normal`, `N` and `albedo` for it. `entering` is the statements a pass runs on entering a closure (its reads of what is kept by closure
 * take the closure's number from it).
 */
export const closureLoop = (
  body: (add: (light: string) => string) => string,
  entering = '',
  lobes = false,
  toon = false,
) => {
  // The toon data the lights add (the pixel's model is toon whichever closure is lit) is taken by the closure's coverage like its light, the ramp applied once to the sum: what a closure adds to it is scaled from what it held before.
  const scaled = (text: string) =>
    toon
      ? `   let toonBefore=vec4f(toonDiffuse,toonWeight);let toonBeforeNoL=toonWeightedNoL;
${text}
   toonDiffuse=toonBefore.xyz+coverage*(toonDiffuse-toonBefore.xyz);toonWeight=toonBefore.w+coverage*(toonWeight-toonBefore.w);toonWeightedNoL=toonBeforeNoL+coverage*(toonWeightedNoL-toonBeforeNoL);`
      : text
  const add = (light: string) => `closureLight+=coverage*${light};`
  return `
 var closureLight=vec4f(0.0);
 let closureCount=closureCountAt(coord);
 for(var closure=0u;closure<closureCount;closure++){
  let coverage=closureWeightAt(coord,closure);${entering}
  if(closure==0u){
${scaled(body(add))}
  }else{
   let slice=closureColourLayer(closure);
   var base=textureLoad(colours,coord,slice,0);
   let normal=textureLoad(colours,coord,slice+1u,0);
   let N=normalize(normal.xyz);
   if(lightView==3u){base.a=0.0;}
   let albedo=select(base.rgb,vec3f(${LIGHTING_ONLY_BRIGHTNESS}),lightView==3u);
${closureModel(lobes)}${scaled(body(add))}
  }
 }
 return closureLight;`
}

/** The lighting channels of the pixel, unpacked from its flags (`litPixelStatements`, `LitPixelCut.channels`). */
export const LIT_CHANNELS_WGSL = wgslBlock(
  'LIT_CHANNELS_WGSL',
  [channelsOfFlags, SURFACE_CHANNELS_WGSL],
  '',
)

/**
 * The statements of a lit pixel, at the head of a lighting pass's fragment (its `pixel` the
 * builtin position): the pixel's `coord`, `surfaceFlag` and `flag`; a pixel no light reaches — the
 * background, an unlit surface, a surface shown as-is — is discarded (`pixelTileClass`), or answered with the statements `miss` where the caller is no fragment; its
 * `base` (the colour and the metalness), `normal` (the normal and the roughness), `emissive` (the
 * emission and the material's occlusion), its depth `z`, point `P`, the direction `V` to the eye
 * and the unit normal `N`; the surface state the light terms read; the thin transmission where the
 * class holds thin pixels, the lobes where it holds some; the view of the lit image asked for
 * (`lightView`, `LIT_VIEWS`) and the `albedo`, the surface's, or white for the view of the lighting
 * alone; where the class holds the shading models a graph picks per pixel (`models`), the pixel's model, set
 * with the data it reads from the thin transmission's target (`setPixelModel`), which also gives the base
 * the pixel is lit with.
 */
export const litPixelStatements = (
  { models, thin, lobes, channels, toonData }: LitPixelCut,
  miss = 'discard;',
) => `
 let coord=vec2i(pixel.xy);
 let surfaceFlag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(pixelTileClass(surfaceFlag)==0u){${miss}}
 var base=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.base},0);
 let normal=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.normal},0);
 let emissive=surfaceEmissiveAo(coord,surfaceFlag);
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 let V=viewToEye(P);let N=normalize(normal.xyz);
 surfaceModel=flag;
 surfaceSpecular=specularOfFlags(surfaceFlag);
${channels ? ' surfaceChannels=channelsOfFlags(surfaceFlag);\n' : ''} let modelBits=modelSwitchBits();
 roughDiffuse=(modelBits&${MODEL_SWITCH.roughDiffuse}u)!=0u;
 shadingAccurate=(modelBits&${MODEL_SWITCH.accurate}u)!=0u;
${
  thin
    ? `
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord).rgb;}`
    : ''
}${
  models
    ? `
 let pixelModelId=pixelModelOf(surfaceFlag);
 ${toonData ? `toonUnified=(modelBits&${MODEL_SWITCH.toonUnified}u)!=0u;\n ` : ''}toonQuantize=(modelBits&${MODEL_SWITCH.toonQuantize}u)!=0u;
 if(pixelModelId!=0u){
  modelTransmitDistance=view.preExposure.w;
  if(pixelModelId==${PIXEL_MODEL.subsurface}u){thinSubsurface=vec3f(0.0);}
  base=setPixelModel(pixelModelId,textureLoad(subsurfaceColor,coord),base,N,V,normal.a,(modelBits&${MODEL_SWITCH.irisNormal}u)!=0u);
  if(${scattersPixelModel('pixelModelId')}){
   // Where the scattering runs, the surface's colour is multiplied back after it and the lit image holds the light apart from it.
   let sssChecker=sssLitChecker(vec2u(pixel.xy),u32(view.jitter.w));
   let sssPost=sssLitPostprocess(modelBits);let sssBoard=sssLitCheckerboard(modelBits);
   base=vec4f(sssLitBase(base.rgb,sssChecker,sssPost,sssBoard),base.a);
   surfaceSpecular=sssLitSpecular(surfaceSpecular,sssChecker,sssPost,sssBoard);
  }
 }`
    : ''
}${
  lobes
    ? `
 clearCoatBottom=(modelBits&${MODEL_SWITCH.clearCoatNormal}u)!=0u;
 ${readLobesStatement(PHYSICAL_SURFACE_FLAG)}`
    : ''
}
 let lightView=u32(view.views.x);
 // The lighting view overrides the surface's colours (diffuse brightness, no specular: neither a dielectric's nor a metal's) and the metalness that would spend the diffuse.
 if(lightView==3u){base.a=0.0;surfaceSpecular=0.0;}
 let albedo=select(base.rgb,vec3f(${LIGHTING_ONLY_BRIGHTNESS}),lightView==3u);`
