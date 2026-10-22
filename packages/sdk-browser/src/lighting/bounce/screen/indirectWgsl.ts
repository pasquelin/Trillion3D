import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../../math/src/wgsl/lighting.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DEFERRED_BINDINGS } from '../../deferred/bindings.ts'
import { SP_META_DECODE } from './historyWgsl.ts'

/**
 * WHAT THE LIGHTING READS OF THE SCREEN PROBES: the pixel's irradiance in `rgb` and its short-range occlusion in
 * `a` (`screenIndirectAt`, at the pixel `coord` the resolve is shading), from the history the probes keep
 * (`SCREEN_PROBE_FORMATS.history`: the light's word, the meta word with the occlusion). An alpha of zero says the
 * screen probes left nothing there — the stand-in the lighting binds where they did not run, or a pixel on no lit
 * surface or that read nothing and held nothing: never a lit pixel the probes read, whose occlusion is never under a
 * thirtieth —, and the lighting reads the world's probes instead (`screenDiffuse` is the pixel's, where they did).
 * `aoMultiBounce` is the occlusion an albedo makes of the short-range occlusion, a surface lit by the light that
 * bounced off the occluders (the albedo capped at `occlusionMaxAlbedo`).
 */
export const SCREEN_INDIRECT_WGSL = wgslBlock(
  'SCREEN_INDIRECT_WGSL',
  [lambertDiffuse, unpackLight, SP_META_DECODE],
  `@group(0) @binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect:texture_2d<u32>;
const SCREEN_MAX_ALBEDO:f32=${SCREEN_PROBE_CONSTANTS.occlusionMaxAlbedo};
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
/** The diffuse radiance of a pixel the screen probes read: their irradiance \`seen.rgb\` under the material's
 *  occlusion \`ao\`, as the world's probes' is, and under their short-range occlusion \`seen.a\`, weighed on the albedo. */
fn screenDiffuse(rgb:vec3f,metal:f32,seen:vec4f,ao:f32)->vec3f{
 let albedo=min(rgb*(1.0-metal),vec3f(SCREEN_MAX_ALBEDO));
 return lambertDiffuse(rgb,metal,seen.rgb,ao)*aoMultiBounce(albedo,seen.a);
}`,
)
