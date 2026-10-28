import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { lambertDiffuse } from '../../../../../math/src/wgsl/lighting.ts'
import { PIXEL_MODEL } from '../../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DEFERRED_BINDINGS } from '../../deferred/bindings.ts'
import { VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'
import { SCREEN_PROBE_FORMATS as F } from './screenProbeLayout.ts'

/** The occlusion an albedo makes of an occlusion `ao` (`bouncedOcclusion`): a surface lit by the light that bounced off the occluders. */
export const BOUNCED_OCCLUSION = wgslBlock(
  'BOUNCED_OCCLUSION',
  [],
  `fn bouncedOcclusion(albedo:vec3f,ao:f32)->vec3f{
 let a=2.0404*albedo-vec3f(0.3324);
 let b=-4.7951*albedo+vec3f(0.6417);
 let c=2.7552*albedo+vec3f(0.6903);
 return max(vec3f(ao),((ao*a+b)*ao+c)*ao);
}`,
)

/**
 * The statement that names whether a lit pixel is foliage for the short-range occlusion (`foliage`, read by `screenOcclusion`): a thin
 * double-sided sheet (its surface flag, where the class holds thin pixels) or a pixel of the subsurface shading model (where the class
 * holds the shading models a graph picks per pixel). It reads the `surfaceFlag` and `pixelModelId` of `litPixelStatements`.
 */
export const screenFoliageStatement = (cut: { thin: boolean; models: boolean }) =>
  `let foliage=${
    [
      ...(cut.thin ? [`(surfaceFlag&${SUBSURFACE_FLAG}u)!=0u`] : []),
      ...(cut.models ? [`pixelModelId==${PIXEL_MODEL.subsurface}u`] : []),
    ].join('||') || 'false'
  };`

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
 * thirtieth —. Where the view's mode is their light, such a pixel has none (no probe weighs on it); where it is their occlusion alone (a level that
 * gathers no light, or an image they did not run in), the lighting takes the sky light's irradiance instead. How the history is read is the view's
 * `screenProbes` words (`writeScreenProbes`): `x` the strength the short-range occlusion applies at on a pixel with backface diffuse light (`screenProbeOcclusionFoliageStrength`),
 * `y` the albedo the multi-bounce is capped at, `z` the intensity of the short-range occlusion and `w` the mode — bit 0 set, the
 * probes' occlusion alone, over the sky light's irradiance (`screenShortRange`), else their light (`screenLights`); bit 1 set, a level that
 * gathers no light at the back of a thin surface (`screenBackGathered`); bit 2 set, the probes' integration applied the short-range occlusion to their light
 * already (`screenProbeShortRangeAOApplyDuringIntegration`), which the lighting then leaves as it is (`screenAppliedInIntegration`).
 * The probes' light is under the material's occlusion already, the integration having applied it through `bouncedOcclusion`; the lighting puts it under the
 * short-range occlusion (`screenOcclusion`), unless the integration did: the multi-bounce of the pixel's base colour on its amount, taken at the intensity, then at the
 * strength on a pixel with backface diffuse light. The specular occlusion reads the amount as it is (`screenSpecularOcclusion`).
 */
export const SCREEN_INDIRECT_WGSL = wgslBlock(
  'SCREEN_INDIRECT_WGSL',
  [lambertDiffuse, unpackLight, SP_BENT_WGSL, VIEW_WGSL, PI, BOUNCED_OCCLUSION, fastAcos],
  `@group(0) @binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect:texture_2d<u32>;
fn screenWordsAt(coord:vec2i)->vec4u{
 let last=vec2i(textureDimensions(screenIndirect))-vec2i(1);
 return textureLoad(screenIndirect,clamp(coord,vec2i(0),last),0);
}
@group(0) @binding(${DEFERRED_BINDINGS.screenShortRangeGi}) var screenShortRangeGi:texture_storage_2d<${F.shortRangeGi},read>;
/** The short-range global illumination the probes gathered at a pixel: the light the near surfaces of the last image give it, which no occlusion darkens. */
fn screenShortRangeGiAt(coord:vec2i)->vec3f{
 return textureLoad(screenShortRangeGi,clamp(coord,vec2i(0),vec2i(textureDimensions(screenShortRangeGi))-vec2i(1))).rgb;
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
 *  amount times pi, along the bent normal, the angle between their axes taken by \`fastAcos\`), none where the sky is almost shut (the amount under a tenth of a turn, faded in over a fifth). */
fn screenSpecularOcclusion(coord:vec2i,N:vec3f,V:vec3f,rough:f32)->f32{
 let word=screenWordsAt(coord);
 if(word.w==0u||screenAppliedInIntegration()){return 1.0;}
 let sky=spBentUnpack(word.w);
 let reflection=reflect(-V,N);
 let between=fastAcos(dot(sky.xyz,reflection));
 let unoccluded=sky.w*PI;
 let covered=screenConeIntersection(max(rough,0.1)*PI,unoccluded,between);
 return mix(0.0,covered,saturate((unoccluded-0.1)/0.2));
}
/** Whether the view's mode is the probes' occlusion alone (\`screenProbes.w\` bit 0). */
fn screenOcclusionOnly()->bool{return (u32(view.screenProbes.w)&1u)!=0u;}
/** Whether the probes gathered the light at the back of a thin surface (\`screenProbes.w\` bit 1 clear). */
fn screenBackGathered()->bool{return (u32(view.screenProbes.w)&2u)==0u;}
/** Whether the probes' integration applied the short-range occlusion to their light and their rough specular (\`screenProbes.w\` bit 2): the lighting applies none. */
fn screenAppliedInIntegration()->bool{return (u32(view.screenProbes.w)&4u)!=0u;}
/** Whether the probes' reading \`seen\` lights the pixel: they left one, and the view's mode is their light. */
fn screenLights(seen:vec4f)->bool{return seen.a>0.0&&!screenOcclusionOnly();}
/** The albedo the multi-bounce reads: the surface's base colour, capped. */
fn screenAlbedo(base:vec3f)->vec3f{return min(base,vec3f(view.screenProbes.y));}
/** The factor the short-range occlusion \`occlusion\` makes of the light of a surface of base colour \`base\`: its multi-bounce on the albedo, taken at the intensity, then,
 *  where the surface has backface diffuse light (\`foliage\`), at the strength. */
fn screenOcclusion(base:vec3f,occlusion:f32,foliage:bool)->vec3f{
 if(screenAppliedInIntegration()){return vec3f(1.0);}
 let intensity=mix(vec3f(1.0),bouncedOcclusion(screenAlbedo(base),occlusion),view.screenProbes.z);
 return mix(vec3f(1.0),intensity,select(1.0,view.screenProbes.x,foliage));
}
/** The factor of the sky light's irradiance where the screen probes left their occlusion alone (\`screenProbes.w\` 1); none elsewhere. */
fn screenShortRange(base:vec3f,seen:vec4f,foliage:bool)->vec3f{
 return select(vec3f(1.0),screenOcclusion(base,seen.a,foliage),seen.a>0.0&&screenOcclusionOnly());
}
/** The diffuse radiance of a pixel the screen probes read: their irradiance \`seen.rgb\` (the material's occlusion already in it) on its diffuse colour \`diffuse\` (\`rgb\`, and the metalness in \`w\`)
 *  under their short-range occlusion \`seen.a\`, taken from its base colour \`base\`. */
fn screenDiffuse(base:vec3f,diffuse:vec4f,seen:vec4f,foliage:bool)->vec3f{
 return lambertDiffuse(diffuse.rgb,diffuse.w,seen.rgb,1.0)*screenOcclusion(base,seen.a,foliage);
}`,
)
