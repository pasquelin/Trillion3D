import { BOUNCE_GRID_WGSL, INVERSE_PI_WGSL } from './gridWgsl.ts';

/**
 * Bounce application, at the bindings the calling pass gives it: opaque deferred resolve and
 * the blend pass read the same probes, with the same law, from two different binding layouts.
 * One implementation, never two.
 *
 * Interpolated probe irradiance multiplies the pixel's diffuse albedo, divided by π: that is
 * the same Lambert law as the direct term, with the same reference implementation. The term is
 * strictly additive to the direct — emission, direct and indirect are partitioned (P3) — and it
 * is exactly zero where no probe sees the point, which forbids a leak through a wall.
 *
 * A pure metal has no diffuse albedo: its indirect share is zero, as in the direct term.
 * Indirect specular is not in this batch, and its absence is declared rather than guessed.
 */
export function bounceApplyWgsl(grid: number, probes: number): string {
  return `
@group(0) @binding(${grid}) var<uniform> bounce:BounceGrid;
@group(0) @binding(${probes}) var<storage,read> probes:array<vec4f>;
${BOUNCE_GRID_WGSL}
${INVERSE_PI_WGSL}
/** Diffuse radiance a pixel returns from light that bounced before reaching it. */
fn bounceLighting(rgb:vec3f,metal:f32,N:vec3f,P:vec3f,ao:f32)->vec3f{
 return rgb*(1.0-metal)*INVERSE_PI*sampleBounce(P,N)*ao;
}`;
}

/** Bounce application at the deferred-resolve bindings, and its two measurement views. */
export const BOUNCE_APPLY_WGSL = `${bounceApplyWgsl(11, 12)}
/** True when the host asked for the indirect-irradiance diagnostic view, and that view only. */
fn bounceOnly()->bool{return bounce.reach.y>0.5;}
/**
 * The pixel's raw indirect irradiance, multiplied by exposure: that is what the harness
 * compares to the compiler oracle. No albedo, no ACES, no sRGB — an image to measure, not an
 * image to look at, and exposure is there only to fit it in the eight bits of the capture.
 * A value beyond one is clipped, and the harness counts what it clipped.
 */
fn bounceIrradiance(N:vec3f,P:vec3f,exposure:f32)->vec3f{return sampleBounce(P,N)*exposure;}`;
