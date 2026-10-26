import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { lambertDiffuse } from '../../../../../math/src/wgsl/lighting.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DEFERRED_BINDINGS } from '../../deferred/bindings.ts'
import { VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'

/**
 * WHAT THE LIGHTING READS OF THE SCREEN PROBES, from the history they keep (`SCREEN_PROBE_FORMATS.history`, four words a pixel, at
 * the pixel `coord` the resolve is shading): the pixel's irradiance in `rgb` and its short-range occlusion in `a`
 * (`screenIndirectAt`), the light of its rough specular reflection (`screenRoughAt`: the radiance of the probes along four
 * points of its specular lobe, or the diffuse light over pi, accumulated like the irradiance), the irradiance at the back of a
 * thin double-sided sheet that transmits light (`screenBackAt`; zero for any other surface), and the direction of the open sky the
 * occlusion found (the unit bent normal in the fourth word, read by `screenSpecularOcclusion`). The
 * rough specular goes under the specular occlusion the bent normal gives (`screenSpecularOcclusion`: the cone of the reflection
 * against the cone of open sky), and takes the place of the radiance around the scene through the lobe in the reflection of a pixel
 * whose rays are not all traced. An alpha of zero says the
 * screen probes left nothing there — the stand-in the lighting binds where they did not run, or a pixel on no lit
 * surface or that read nothing and held nothing: never a lit pixel the probes read, whose occlusion is never under a
 * thirtieth —, and the lighting takes the sky light's irradiance instead. How the history is read is the view's
 * `screenProbes` words (`writeScreenProbes`): `x`, whether the material's occlusion multiplies the probes' light, `y`
 * the albedo the multi-bounce is capped at, `z` the strength of the short-range occlusion and `w` the mode — bit 0 set, the
 * probes' occlusion alone, over the sky light's irradiance (`screenShortRange`), else their light (`screenLights`); bit 1 set, a level that
 * gathers no light at the back of a thin surface (`screenBackGathered`).
 * `aoMultiBounce` is the occlusion an albedo makes of an occlusion, a surface lit by the light that bounced off the
 * occluders. The probes' light is under the material's occlusion through it, as the albedo makes of it
 * (`screenMaterial`), then under the short-range occlusion, taken at its strength after it (`screenOcclusion`).
 */
export const SCREEN_INDIRECT_WGSL = wgslBlock(
  'SCREEN_INDIRECT_WGSL',
  [lambertDiffuse, unpackLight, SP_BENT_WGSL, VIEW_WGSL, PI],
  `@group(0) @binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect:texture_2d<u32>;
fn screenWordsAt(coord:vec2i)->vec4u{
 let last=vec2i(textureDimensions(screenIndirect))-vec2i(1);
 return textureLoad(screenIndirect,clamp(coord,vec2i(0),last),0);
}
fn screenOcclusionOf(word:vec4u)->f32{return select(0.0,max(spBentUnpack(word.w).w,1.0/255.0),word.w!=0u);}
fn screenIndirectAt(coord:vec2i)->vec4f{
 let word=screenWordsAt(coord);
 return vec4f(unpackLight(word.x),screenOcclusionOf(word));
}
fn screenRoughAt(coord:vec2i)->vec3f{return unpackLight(screenWordsAt(coord).y);}
fn screenBackAt(coord:vec2i)->vec3f{return unpackLight(screenWordsAt(coord).z);}
/** The share of the cone of angle \`arc0\` that the cone of angle \`arc1\` covers, their axes \`between\` apart (an approximation, smooth). */
fn screenConeIntersection(arc0:f32,arc1:f32,between:f32)->f32{
 let difference=abs(arc0-arc1);
 return smoothstep(0.0,1.0,1.0-saturate((between-difference)/max(arc0+arc1-difference,1e-6)));
}
/** The share of a pixel's specular reflection the open sky leaves it: the cone of the reflection of the view \`V\` about the normal \`N\`
 *  (the width of a lobe of roughness \`rough\` — a tenth at least — times pi) against the cone of the open sky the occlusion found (its
 *  amount times pi, along the bent normal), none where the sky is almost shut (the amount under a tenth of a turn, faded in over a fifth). */
fn screenSpecularOcclusion(coord:vec2i,N:vec3f,V:vec3f,rough:f32)->f32{
 let word=screenWordsAt(coord);
 if(word.w==0u){return 1.0;}
 let sky=spBentUnpack(word.w);
 let reflection=reflect(-V,N);
 let between=acos(clamp(dot(sky.xyz,reflection),-1.0,1.0));
 let unoccluded=sky.w*PI;
 let covered=screenConeIntersection(max(rough,0.1)*PI,unoccluded,between);
 return mix(0.0,covered,saturate((unoccluded-0.1)/0.2));
}
fn aoMultiBounce(albedo:vec3f,ao:f32)->vec3f{
 let a=2.0404*albedo-vec3f(0.3324);
 let b=-4.7951*albedo+vec3f(0.6417);
 let c=2.7552*albedo+vec3f(0.6903);
 return max(vec3f(ao),((ao*a+b)*ao+c)*ao);
}
/** Whether the view's mode is the probes' occlusion alone (\`screenProbes.w\` bit 0). */
fn screenOcclusionOnly()->bool{return (u32(view.screenProbes.w)&1u)!=0u;}
/** Whether the probes gathered the light at the back of a thin surface (\`screenProbes.w\` bit 1 clear). */
fn screenBackGathered()->bool{return u32(view.screenProbes.w)<2u;}
/** Whether the probes' reading \`seen\` lights the pixel: they left one, and the view's mode is their light. */
fn screenLights(seen:vec4f)->bool{return seen.a>0.0&&!screenOcclusionOnly();}
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
/** The factor of the sky light's irradiance where the screen probes left their occlusion alone (\`screenProbes.w\` 1); none elsewhere. */
fn screenShortRange(rgb:vec3f,metal:f32,seen:vec4f)->vec3f{
 return select(vec3f(1.0),screenOcclusion(rgb,metal,seen.a),seen.a>0.0&&screenOcclusionOnly());
}
/** The diffuse radiance of a pixel the screen probes read: their irradiance \`seen.rgb\` under the material's
 *  occlusion \`ao\` and under their short-range occlusion \`seen.a\`. */
fn screenDiffuse(rgb:vec3f,metal:f32,seen:vec4f,ao:f32)->vec3f{
 return lambertDiffuse(rgb,metal,seen.rgb,1.0)*screenMaterial(rgb,metal,ao)*screenOcclusion(rgb,metal,seen.a);
}`,
)
