/**
 * WHAT EVERY PASS THAT LIGHTS A SURFACE READS OF IT, written once: the declarations of the
 * surface's bindings — each pass lists the ones it reads, and its layout holds those alone
 * (`layoutEntries.ts`) — and the statements that read a lit pixel (`litPixelStatements`): its flags, its
 * colour, normal and depth, the point and the directions it is seen from, the state the light terms
 * read it through (`surfaceModel`, `surfaceSpecular`, `thinSubsurface`, the lobes).
 * The sun's pass, the local lights' and the indirect light's read the same pixel the same way, so
 * their terms are the parts of one sum.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
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
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { readLobesStatement } from '../direct/lobesWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from '../direct/shadingModelState.ts'
import { SSS_LIT_WGSL } from '../subsurface/litHook.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { PIXEL_TILE_CLASS_WGSL, TILE_CLASS, type TileClass } from './tileClass.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from './worldAtWgsl.ts'

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

/**
 * What the pixels of a class of tile may need (`CLASS_CUTS`), and so what the programs of the class
 * hold: the diffuse and toon models (`models`), the thin transmission (`thin`: read from its target,
 * and lit through the surface from either side), the anisotropic and clear-coat lobes (`lobes`: read
 * from their target, and run by the light terms).
 */
export interface LitPixelCut {
  models: boolean
  thin: boolean
  lobes: boolean
}

/** The cut of each class: a tile is of the class of its most demanding pixel (`pixelTileClass`), so
 *  each class holds what the ones below it do. */
export const CLASS_CUTS: Record<TileClass, LitPixelCut> = {
  [TILE_CLASS.simple]: { models: false, thin: false, lobes: false },
  [TILE_CLASS.single]: { models: true, thin: true, lobes: false },
  [TILE_CLASS.complex]: { models: true, thin: true, lobes: true },
}

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
    SHADING_MODEL_STATE_WGSL,
    SSS_LIT_WGSL,
  ],
  `
/** The view's switches of the shading models and of the lit image (\`views.w\`), read once for the pixel's statements and the light's term. */
fn modelSwitchBits()->u32{return u32(view.views.w);}
/** A light's term in the lit image: the light multiplied by the pre-exposure and held to what the
 *  emission may be (\`preExposedClipped\`), unheld in the view of the lighting on a white surface; its alpha the pre-exposed
 *  luminance of the light the subsurface scattering spreads (\`scatterAdd\`), where the pass that spreads it runs
 *  (\`sssLitResult\`). */
fn lightOut(rgb:vec3f,lightView:u32)->vec4f{
 let bits=modelSwitchBits();
 return sssLitResult(select(preExposedClipped(rgb),preExposed(rgb),lightView==3u),scatterLuma*view.preExposure.x,sssLitPostprocess(bits),sssLitCheckerboard(bits));
}`,
)

/**
 * The statements of a lit pixel, at the head of a lighting pass's fragment (its `pixel` the
 * builtin position): the pixel's `coord`, `surfaceFlag` and `flag`; a pixel no light reaches — the
 * background, an unlit surface, a surface shown as-is — is discarded (`pixelTileClass`); its
 * `base` (the colour and the metalness), `normal` (the normal and the roughness), `emissive` (the
 * emission and the material's occlusion), its depth `z`, point `P`, the direction `V` to the eye
 * and the unit normal `N`; the surface state the light terms read; the thin transmission where the
 * class holds thin pixels, the lobes where it holds some; the view of the lit image asked for
 * (`lightView`, `LIT_VIEWS`) and the `albedo`, the surface's, or white for the view of the lighting
 * alone; where the class holds the shading models a graph picks per pixel (`models`), the pixel's model, set
 * with the data it reads from the thin transmission's target (`setPixelModel`), which also gives the base
 * the pixel is lit with.
 */
export const litPixelStatements = ({ models, thin, lobes }: LitPixelCut) => `
 let coord=vec2i(pixel.xy);
 let surfaceFlag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(pixelTileClass(surfaceFlag)==0u){discard;}
 ${models ? 'var' : 'let'} base=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.base},0);
 let normal=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.normal},0);
 let emissive=surfaceEmissiveAo(coord,surfaceFlag);
 let z=textureLoad(depth,coord,0);
 let P=worldAt(pixel.xy,z);
 let V=viewToEye(P);let N=normalize(normal.xyz);
 surfaceModel=flag;
 surfaceSpecular=specularOfFlags(surfaceFlag);
 let modelBits=modelSwitchBits();
${
  thin
    ? `
 if((surfaceFlag&${SUBSURFACE_FLAG}u)!=0u){thinSubsurface=textureLoad(subsurfaceColor,coord).rgb;}`
    : ''
}${
  models
    ? `
 let pixelModelId=pixelModelOf(surfaceFlag);
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
 let albedo=select(base.rgb,vec3f(1.0),lightView==3u);`
