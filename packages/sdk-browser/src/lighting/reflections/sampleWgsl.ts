import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { visibleGgxHalf } from '../../../../math/src/wgsl/sampling.ts'
import { tangentFallback } from '../../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_GROUP, reflectionBindingsWgsl } from './viewLayout.ts'

/** A sampled ray of a lobe (`reflectionLobeRay`), what the chain's stages trace (`wgsl.ts`): its
 *  direction `R`, the thin lobe it is read through — the lobe's long axis and the smoothest α
 *  (`axis`) —, and the widths of the lobe it stands for across (`alpha`) and along its axis (`along`). */
export const REFLECTION_LOBE_RAY_WGSL = wgslBlock(
  'REFLECTION_LOBE_RAY_WGSL',
  [],
  'struct ReflectionLobeRay{R:vec3f,axis:vec4f,alpha:f32,along:f32,}',
)

/** The tangent frame of a lobe at a surface of normal `N` (`reflectionFrameOf`): `T` the stored axis kept orthogonal to the normal, the
 *  tangent where there is none, and `B` across it — the frame a lobe's widths along its axis and across are laid on. */
export const REFLECTION_FRAME_WGSL = wgslBlock(
  'REFLECTION_FRAME_WGSL',
  [tangentFallback, vectorRejection],
  `struct ReflectionFrame{T:vec3f,B:vec3f,}
fn reflectionFrameOf(N:vec3f,axis:vec3f)->ReflectionFrame{
 var T=vectorRejection(axis,N);
 if(dot(T,T)<1e-12){T=tangentFallback(N);}
 T=normalize(T);
 return ReflectionFrame(T,cross(N,T));
}`,
)

/**
 * EVERY LOBE, SAMPLED (`reflectionLobeRay`, the trace's kernels', `u` the texel's blue noise of the image,
 * `reflectionSampleAt`, `trace/trace.ts`): every lobe that traces (`reach.ts`) casts its ray in a direction drawn from its
 * own GGX distribution, a new one every image,
 * so that the history's images (`temporalWgsl.ts`) and the neighbours' reuse (`resolveWgsl.ts`) average
 * the whole lobe, its long tail included. A mirror is the limit: its widths at the smoothest lobe the
 * engine draws, its draws all within a fraction of a degree of its centre — its sample is its centre
 * ray, with no rule of its own.
 *
 * - DIRECTION: the half-vector drawn among the normals the eye sees (`reflectionSampleDirection`): the
 *   view stretched by the lobe's widths along its axis and across, a direction drawn on the spherical cap
 *   the visible normals cover (`visibleGgxHalf`, its height bounded by the view's reflection) — its height
 *   drawn over all but the sampling bias's share of it nearest the horizon, the grazing microfacets whose
 *   rays are the noisiest and dimmest —, unstretched; the ray its mirror about it, its pdf that of the half vector, 2 (v·h) D(h) /
 *   (k n·v + |v̂|) with `k` the bound (`reflectionHalfPdf`), over 4 (v·h) (`reflectionRayPdf`), which the reuse weighs by (`resolveWgsl.ts`) and
 *   whose inverse is the ray's cone.
 * - THIN RAYS: each ray is read through the cone of the smoothest lobe the engine draws (`lobeAlpha(0)`,
 *   under a pixel over the whole march), so the mean of the rays is the lobe's own. A wider cone with a
 *   narrower draw is not: GGX slopes have no variance, widths do not add in quadrature, and a draw
 *   narrowed by √(1 − c²) takes near a quarter of the tail's mass three widths out (c = ½: P(|s| > 3α)
 *   falls from 1/10 to 1/13) — the radiance a small bright body brings to the lobe's edge.
 * - SEQUENCE: (u, v) from the engine's spatiotemporal blue noise, read at the grid texel and the image's turn
 *   (`ReflectionView.temporal.x`): blue across the grid and across the images of a texel's history.
 *
 * The lobe a pixel traces is its top layer's, the coat's where it carries one (`reflectionTopRay`,
 * `weight.ts`), sampled the same way.
 */
export const REFLECTION_SAMPLE_WGSL = wgslBlock(
  'REFLECTION_SAMPLE_WGSL',
  [
    reflectionBindingsWgsl(REFLECTION_GROUP),
    REFLECTION_CONSTANTS_WGSL,
    visibleGgxHalf,
    REFLECTION_FRAME_WGSL,
    LOBE_AXIS_WGSL,
    REFLECTION_LOBE_RAY_WGSL,
  ],
  `fn reflectionSampleDirection(N:vec3f,V:vec3f,axis:vec3f,widths:vec2f,u:vec2f)->vec3f{
 let f=reflectionFrameOf(N,axis);
 let h=visibleGgxHalf(vec2f(u.x,u.y*(1.0-reflectionView.lobe.z)),widths,vec3f(dot(V,f.T),dot(V,f.B),max(dot(V,N),1e-4)));
 return reflect(-V,normalize(h.x*f.T+h.y*f.B+h.z*N));
}
fn reflectionLobeRay(N:vec3f,V:vec3f,alpha:f32,lobe:vec4f,u:vec2f)->ReflectionLobeRay{
 let R=reflectionSampleDirection(N,V,lobe.xyz,vec2f(lobe.w,alpha),u);
 let thin=lobeAlpha(0.0);
 return ReflectionLobeRay(R,vec4f(lobe.xyz,thin),alpha,lobe.w);
}`,
)
