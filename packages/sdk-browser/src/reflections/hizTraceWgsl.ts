import { MIRROR_TRANSITION_END } from './modelShader.ts'

/** Which pixel of its 2 × 2 block a half-resolution trace texel serves at `seed`: the four in
 *  turn, so four frames reach every pixel. The trace and the history resolve read the same one. */
export const REFLECTION_PHASE_WGSL = `
fn reflectionPhase(seed:u32)->vec2i{return vec2i(i32(((seed+1u)>>1u)&1u),i32(seed&1u));}`

/** The bounded ray: from its receiver lifted one pixel's footprint along the normal
 *  (`shadowFootprint`, which both callers set first), clipped as the full walk's (`reflectionExit`),
 *  then walked over the depth pyramid as the mirror's (`screenReflection`, `traceShader.ts`).
 *  Unlifted, a glossy ray leaving its plane at a grazing angle met that plane's own depth a pixel
 *  or two on — a pixel centre's depth inside the ray's span over it — and read the receiver back:
 *  the dark grain of a glossy car roof (#831). Lifted, the plane's depth over the next pixels stays
 *  behind the ray. A hit reads the reprojected source, whose alpha tells a pixel the last image did
 *  not see: a miss. A miss reads the program's filtered reflection at the first roughness the
 *  probes filter — never a proxy ray per pixel. A rough sample (#33) and the water's mirror (#1279)
 *  resolve their ray by it alike. */
export const HIZ_TRACE_WGSL = `
fn boundedReflectionRay(P:vec3f,N:vec3f,R:vec3f)->vec3f{
 let hit=screenReflection(P+N*shadowFootprint,R);
 if(hit.a!=0.0){return hit.rgb;}
 return filteredReflectedRadiance(P,N,R,${MIRROR_TRANSITION_END});
}`
