/**
 * THE FIRST PASSES OF THE LIT IMAGE, one fullscreen draw each, which write every pixel before any
 * light is added to it:
 * - `surfaceColourMain`, the lit view's: what a pixel is before a light reaches it — the background
 *   colour where no surface was drawn, a surface shown as it is, an unlit surface's colour, a lit
 *   surface's emission under the occlusion the view applies, which the direct and the indirect
 *   light are added to;
 * - `unlitSurfaceMain`, the unlit view's: the material's colour as it is and the emission it keeps,
 *   no light and no fog (`UNLIT_COMPOSITIONS`).
 * A diagnostic view of one lighting term (`LIT_VIEWS`) leaves a lit surface black here, so that
 * the term alone reaches the image.
 */
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { srgbToLinear } from '../../../../math/src/wgsl/color.ts'
import { SURFACE_COLOUR_LAYERS, SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import {
  AS_IS_FLAG,
  SURFACE_MODEL_MASK,
  UNLIT_FLAG,
} from '../../materials/surface/surfaceModelWord.ts'
import { HOLDOUT_SURFACE_FLAG } from '../../materials/surface/surfaceModel.ts'
import { pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { AMBIENT_OCCLUSION_READ_WGSL, AMBIENT_OCCLUSION_STATEMENT } from './ambientOcclusionWgsl.ts'
import {
  COLOURS_BINDING_WGSL,
  EMISSIVE_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  VIEW_PRE_EXPOSED_WGSL,
  WORDS_BINDING_WGSL,
} from './litSurfaceWgsl.ts'

/** The entries of the two programs. */
export const SURFACE_COLOUR_ENTRY = 'surfaceColourMain'
export const UNLIT_SURFACE_ENTRY = 'unlitSurfaceMain'

/**
 * A pixel no surface drew, where no sky is drawn (an atmosphere draws it over this one,
 * `../atmosphere/skyWgsl.ts`): the background colour, as the scene radiance it is — its sRGB channels
 * decoded to linear light —, in the lit image like every other pixel's colour, so that it goes through
 * the exposure and the tone table as they do (a mirror that sees it adds the same radiance,
 * `../reflections/surroundings.ts`). A height fog lies over it as over any pixel (the fog pass,
 * `../fog/fogPass.ts`). The raw output of a diagnostic view takes the colour as it is, not as radiance. The image's alpha is the share of the background left visible: 1 here, 0 on every
 * surface (the diffuse light a subsurface pixel accumulates in it until the recombine writes 0 again).
 */
export const SURFACE_COLOUR_WGSL = wgslBlock(
  'SURFACE_COLOUR_WGSL',
  [
    COLOURS_BINDING_WGSL,
    EMISSIVE_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    VIEW_BINDING_WGSL,
    AMBIENT_OCCLUSION_READ_WGSL,
    VIEW_PRE_EXPOSED_WGSL,
    srgbToLinear,
    FULLSCREEN_VERTEX,
    pixelModelOf,
  ],
  `
@fragment fn ${SURFACE_COLOUR_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let surfaceFlag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;let flag=surfaceFlag&${SURFACE_MODEL_MASK}u;
 if(flag==0u){
  // The raw output of a diagnostic view takes the colour as it is.
  if(view.viewport.z!=0.0){return vec4f(view.background.rgb,1.0);}
  return vec4f(preExposed(srgbToLinear(view.background.rgb)),1.0);
 }
 let base=textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.base},0);
 if(flag==${AS_IS_FLAG}u){return vec4f(base.rgb,0.0);}
 // A held-out primitive's pixel is black and a hole in the alpha.
 if(flag==${UNLIT_FLAG}u){return vec4f(preExposedClipped(base.rgb),select(0.0,1.0,(surfaceFlag&${HOLDOUT_SURFACE_FLAG}u)!=0u));}
 // A view of one lighting term shows that term alone: the surface is black before it.
 if(view.views.x!=0.0){return vec4f(0.0);}
 // The emission-and-occlusion texel only where its bit says it holds something.
 let emissive=surfaceEmissiveAo(coord,surfaceFlag);
 ${AMBIENT_OCCLUSION_STATEMENT}
 // The alpha of a surface is 0, the share of the background it leaves visible; a pixel the subsurface scattering
 // spreads gathers the luminance of its diffuse light in it (\`lightOut\`) until the recombine.
 return vec4f(preExposedClipped(emissive.rgb*occlusion.emission),0.0);
}`,
)

/**
 * Unlit view: material albedo as-is, with no light and no ambient; what a surface emits is kept, as
 * in the lit image (#1362). This is not a light, it is a diagnostic view — the one geometry benches
 * that compare images pixel for pixel ask for, and the one the engine renders by default as long as
 * no light is declared, because a scene with no source has nothing to light.
 */
export const UNLIT_SURFACE_WGSL = wgslBlock(
  'UNLIT_SURFACE_WGSL',
  [
    COLOURS_BINDING_WGSL,
    EMISSIVE_BINDING_WGSL,
    WORDS_BINDING_WGSL,
    VIEW_BINDING_WGSL,
    srgbToLinear,
    FULLSCREEN_VERTEX,
  ],
  `
@fragment fn ${UNLIT_SURFACE_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r;
 if(flag==0u){return vec4f(select(srgbToLinear(view.background.rgb),view.background.rgb,view.viewport.z!=0.0),1.0);}
 return vec4f(textureLoad(colours,coord,${SURFACE_COLOUR_LAYERS.base},0).rgb+surfaceEmissiveAo(coord,flag).rgb,0.0);
}`,
)
