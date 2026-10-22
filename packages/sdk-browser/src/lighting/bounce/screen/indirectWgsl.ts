import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../../math/src/wgsl/lighting.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DEFERRED_BINDINGS } from '../../deferred/bindings.ts'
import { VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'
import { SP_META_DECODE } from './historyWgsl.ts'

/**
 * WHAT THE LIGHTING READS OF THE SCREEN PROBES: the pixel's irradiance in `rgb` and its short-range occlusion in
 * `a` (`screenIndirectAt`, at the pixel `coord` the resolve is shading), from the history the probes keep
 * (`SCREEN_PROBE_FORMATS.history`: the light's word, the meta word with the occlusion). An alpha of zero says the
 * screen probes left nothing there — the stand-in the lighting binds where they did not run, or a pixel on no lit
 * surface or that read nothing and held nothing: never a lit pixel the probes read, whose occlusion is never under a
 * thirtieth —, and the lighting reads the world's probes instead. How the history is read is the view's
 * `screenProbes` words (`writeScreenProbes`): `x`, whether the material's occlusion multiplies the probes' light, `y`
 * the albedo the multi-bounce is capped at, `z` the strength of the short-range occlusion and `w` the mode — 0 the
 * probes' light (`screenLights`), 1 their occlusion alone, over the world's probes' light (`screenShortRange`).
 * `aoMultiBounce` is the occlusion an albedo makes of an occlusion, a surface lit by the light that bounced off the
 * occluders. The probes' light is under the material's occlusion through it, as the albedo makes of it
 * (`screenMaterial`), then under the short-range occlusion, taken at its strength after it (`screenOcclusion`).
 */
export const SCREEN_INDIRECT_WGSL = wgslBlock(
  'SCREEN_INDIRECT_WGSL',
  [lambertDiffuse, unpackLight, SP_META_DECODE, VIEW_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect:texture_2d<u32>;
fn screenIndirectAt(coord:vec2i)->vec4f{
 let last=vec2i(textureDimensions(screenIndirect))-vec2i(1);
 let word=textureLoad(screenIndirect,clamp(coord,vec2i(0),last),0).rg;
 return vec4f(unpackLight(word.x),spMetaOcclusion(word.y));
}
fn aoMultiBounce(albedo:vec3f,ao:f32)->vec3f{
 let a=2.0404*albedo-vec3f(0.3324);
 let b=-4.7951*albedo+vec3f(0.6417);
 let c=2.7552*albedo+vec3f(0.6903);
 return max(vec3f(ao),((ao*a+b)*ao+c)*ao);
}
/** Whether the probes' reading \`seen\` lights the pixel: they left one, and the view's mode is their light. */
fn screenLights(seen:vec4f)->bool{return seen.a>0.0&&view.screenProbes.w<0.5;}
/** The albedo the multi-bounce reads, capped. */
fn screenAlbedo(rgb:vec3f,metal:f32)->vec3f{return min(rgb*(1.0-metal),vec3f(view.screenProbes.y));}
/** The probes' light under the material's occlusion \`ao\`: its multi-bounce on the albedo, or none where the setting is off. */
fn screenMaterial(rgb:vec3f,metal:f32,ao:f32)->vec3f{
 return select(vec3f(1.0),aoMultiBounce(screenAlbedo(rgb,metal),ao),view.screenProbes.x>0.5);
}
/** The factor the short-range occlusion \`occlusion\` makes of the light: its multi-bounce on the albedo, taken at the strength. */
fn screenOcclusion(rgb:vec3f,metal:f32,occlusion:f32)->vec3f{
 return mix(vec3f(1.0),aoMultiBounce(screenAlbedo(rgb,metal),occlusion),view.screenProbes.z);
}
/** The factor of the world's probes' light where the screen probes left their occlusion alone (\`screenProbes.w\` 1); none elsewhere. */
fn screenShortRange(rgb:vec3f,metal:f32,seen:vec4f)->vec3f{
 return select(vec3f(1.0),screenOcclusion(rgb,metal,seen.a),seen.a>0.0&&view.screenProbes.w>=0.5);
}
/** The diffuse radiance of a pixel the screen probes read: their irradiance \`seen.rgb\` under the material's
 *  occlusion \`ao\` and under their short-range occlusion \`seen.a\`. */
fn screenDiffuse(rgb:vec3f,metal:f32,seen:vec4f,ao:f32)->vec3f{
 return lambertDiffuse(rgb,metal,seen.rgb,1.0)*screenMaterial(rgb,metal,ao)*screenOcclusion(rgb,metal,seen.a);
}`,
)
