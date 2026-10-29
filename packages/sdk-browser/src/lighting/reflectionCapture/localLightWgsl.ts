import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { offSpecularPeakDirection } from '../deferred/ambientCubemapWgsl.ts'
import { ENVIRONMENT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts'
import { reflectionCapturesWgsl, type ReflectionCaptureBindings } from './compositeWgsl.ts'

/**
 * THE LOCAL LIGHT OF A PASS THAT READS THE REFLECTION CAPTURES, over the bindings `b`: the two hooks the indirect pass's reflection and ambient light
 * take (`reflectionResolveWgsl`, `capturedAmbient`), with the pixel's point (`capturePoint`, which the pass sets from its pixel before it lights it).
 * - `resolvedLocalLight(sky, N, V, rough)`: the rough light of a lobe. The captures are composited over the sky, as the reference's
 *   deferred reflections do — the direction read is the reflection drawn toward the normal as the roughness widens the lobe
 *   (`offSpecularPeakDirection`) — and what they let through is the sky: the captures' light plus what they leave times `sky`;
 * - `capturedAmbient(sky, rgb, metal, N, ao)`: with the captures' diffuse light on (the block's flag), the sky light's diffuse light given
 *   way to by the share the captures cover, and theirs added — the captures' light along the normal, as the irradiance of the environment's sum
 *   (`environmentLightingFrom`), under the occlusion `ao`; else the sky light's as it is.
 */
export const capturedLocalLightWgsl = (b: ReflectionCaptureBindings) =>
  wgslBlock(
    `CAPTURED_LOCAL_LIGHT_WGSL(${b.group}, ${b.cube})`,
    [reflectionCapturesWgsl(b), offSpecularPeakDirection, ENVIRONMENT_LIGHTING_WGSL, PI],
    `var<private> capturePoint:vec3f;
fn resolvedLocalLight(sky:vec3f,N:vec3f,V:vec3f,rough:f32)->vec3f{
 let safe=clamp(rough,0.001,1.0);
 let local=reflectionCapturesAt(capturePoint,N,offSpecularPeakDirection(N,reflect(-V,N),safe),safe,true,false);
 return local.specular.rgb+local.specular.a*sky;
}
fn capturedAmbient(sky:vec3f,rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 if(captures.header.z<=0.0){return sky;}
 let local=reflectionCapturesAt(capturePoint,N,N,1.0,false,true).diffuse;
 return sky*local.a+environmentLightingFrom(rgb,metal,PI*local.rgb,ao);
}`,
  )
