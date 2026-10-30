import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INDIRECT_WGSL } from './indirectWgsl.ts'
import { screenIndirectWgsl } from './screen/indirectWgsl.ts'

/**
 * Bounce application (`bounceLighting`), as the opaque deferred resolve gives it, and its measurement view (`bounceIrradiance`): the
 * screen probes' irradiance, the pixel's diffuse term. (The see-through surfaces read the translucency volume instead,
 * `../translucencyGi/readWgsl.ts`, one fetch for their fragments' gather.)
 *
 * Irradiance multiplies the pixel's diffuse albedo, times 1/π: that is the same Lambert law as the direct term, with the same
 * function (`lambertAlbedoMul`). The term is strictly additive to the direct — emission, direct and indirect are partitioned.
 *
 * A pure metal has no diffuse albedo: its indirect share is zero, as in the direct term. Indirect specular is not part of this term:
 * the reflection reads the screen probes' rough light, and the radiance around the scene beyond what its rays meet.
 *
 * The screen probes carry the sky the scene lets through (a ray of theirs that leaves the scene reaches it, `skyProbeRadiance`), so a
 * program that reads them takes the sky light's diffuse share from them alone, never added again beside them (`environmentSky`, zero
 * here); the pixel they did not read has none where their level gathers light, and the sky light's own irradiance (`indirectIrradiance`) where it gathers none or they did not run
 * (`screenOcclusionOnly`).
 */
export const bounceApplyWgsl = (closures: boolean) =>
  wgslBlock(
    closures ? 'BOUNCE_APPLY_WGSL(closures)' : 'BOUNCE_APPLY_WGSL',
    [lambertDiffuse, INDIRECT_WGSL, screenIndirectWgsl(closures)],
    `
/** What the environment adds of the sky light's diffuse: nothing, the screen probes carry it. */
fn environmentSky(N:vec3f,ao:f32)->vec3f{return vec3f(0.0);}
/** Diffuse radiance a pixel the screen probes did not read returns: the sky's. */
fn bounceLighting(rgb:vec3f,metal:f32,N:vec3f,P:vec3f,ao:f32)->vec3f{
 return lambertDiffuse(rgb,metal,indirectIrradiance(P,N),ao);
}
/**
 * The pixel's raw indirect irradiance at \`coord\`, multiplied by exposure: that is what the harness
 * compares to the compiler oracle. No albedo, no ACES, no sRGB — an image to measure, not an
 * image to look at, and exposure is there only to fit it in the eight bits of the capture.
 * A value beyond one is clipped, and the harness counts what it clipped.
 */
fn bounceIrradiance(coord:vec2i,N:vec3f,P:vec3f,exposure:f32)->vec3f{
 let seen=screenIndirectAt(coord);
 if(screenLights(seen)){return seen.rgb*exposure;}
 return select(vec3f(0.0),indirectIrradiance(P,N),screenOcclusionOnly())*exposure;
}`,
  )

/** The application for a view of one closure. */
export const BOUNCE_APPLY_WGSL = bounceApplyWgsl(false)
