import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import { SURFACE_WORDS_FORMAT } from '../materials/surface/surfaceOutputs.ts'
import { hizDepthWgsl } from '../visibility/hiz/gpu/pyramidTexture.ts'
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP } from '../lighting/reflections/viewLayout.ts'
import { SHADING_MODEL_STATE_WGSL } from '../lighting/direct/shadingModelState.ts'
import { subsurfaceOpacityOfModel } from '../materials/surface/surfaceModelWord.ts'
import { FACING_MATERIAL_MASK } from './facing.ts'
import { WORDS, materialFlagOf } from './vertexReadsWgsl.ts'

/** The opaque surfaces' flags, a read-only storage texture read by load (`bindLayout.ts` holds the binding's place). */
const SURFACE_FLAGS = loadOnlyTarget(
  BLEND_BINDINGS.surfaceFlags,
  SURFACE_WORDS_FORMAT,
  'contactFlags',
)

/** The statements that set the ask from the material's flag (the triangle word's), and the material the ray's hit reads the opacity of
 *  its thin subsurface from, to attenuate the shadow by (`contactAttenuation`), before the lights are read. */
export const SET_CONTACT_ASKED = `contactAsked=contactShadowsAsked(in);contactMaterial=in.${WORDS.material}&${FACING_MATERIAL_MASK}u;`

/**
 * WHAT THE CONTACT SHADOWS' RAYS READ IN THE BLEND PASS (`../lighting/contactShadow/contactShadowWgsl.ts`, `asked`): the opaque
 * depth, level 0 of the depth pyramid the pass binds (`hizOpaqueDepth`), the flags of the opaque surfaces, and whether the
 * fragment's material asks (`contactAsked`, set from `contactShadowsAsked`, the material's flag in the triangle word). A translucent
 * surface casts a ray only where its material asks, and its hit's shadow keeps the share a thin subsurface lets through
 * (`contactOpacity`, the opacity byte of the model word of the material `contactMaterial`, read at a hit alone).
 */
export const BLEND_CONTACT_SCENE_WGSL = wgslBlock(
  'BLEND_CONTACT_SCENE_WGSL',
  [
    hizDepthWgsl(REFLECTION_GROUP, REFLECTION_DEPTH_BINDING),
    SHADING_MODEL_STATE_WGSL,
    subsurfaceOpacityOfModel,
  ],
  `${SURFACE_FLAGS.wgsl}
var<private> contactAsked:bool=false;
var<private> contactMaterial:u32=0u;
fn contactSceneDepth(pixel:vec2i)->f32{return hizOpaqueDepth(pixel);}
fn contactSceneFlags(pixel:vec2i)->u32{return textureLoad(contactFlags,pixel).r;}
fn contactShadowsAsked(in:VSOut)->bool{return ${materialFlagOf('contactShadows')};}
fn contactOpacity(material:u32)->f32{return subsurfaceOpacityOfModel(materialAt(material).model);}`,
)
