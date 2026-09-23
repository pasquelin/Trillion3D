import { BOUNCE_TRACE_WGSL } from '../../bounce/traceWgsl.ts';

/**
 * Sun shadow beyond the last clipmap level, traced against the scene's resident proxy.
 *
 * Cascades cover a published fraction of the camera far plane; farther out, a surface
 * stayed lit with no shadow test — an interior seen from afar looked like full daylight, then
 * went black when the camera approached and a clipmap level took it over. One shadow ray per
 * affected pixel removes that step: the same ray the probes fire, against the same
 * traversal of the same proxy, without a line of geometry in duplicate.
 *
 * The ray is deterministic — its direction is the sun's, its origin the pixel's — so
 * two frames of a still camera yield exactly the same far shadow. Nothing is accumulated
 * from one frame to the next: there is no lag, no trail, no noise of this batch's own.
 *
 * Bounds are those of the bounce traversal, published with it (X2): a ray that exhausts
 * its nodes finds no occluder, so it lights. That is a named approximation of this batch,
 * on the same footing as the proxy's certified geometric error, which shifts the shadow outline.
 *
 * Both lighting passes receive exactly this code, on exactly one binding: the resident
 * proxy and its settings fit in a single storage buffer (`residentProxyWgsl`), so a far
 * blend surface is shadowed by the same ray as an opaque surface. There is no plug left,
 * no path that returns one without having searched.
 */
/** Binding rank of the resident proxy in the deferred-resolution layout. */
export const SUN_FAR_PROXY_BINDING = 13;

/**
 * Fraction of sun that reaches a point no clipmap level covers: zero if the proxy cuts the
 * ray, one otherwise. The ray starts from a proxy cell farther along, or the coarse surface
 * would shadow the true surface it approaches.
 *
 * With no proxy in the cache, present is zero and the far surface stays lit without shadow,
 * exactly as before this batch: unavailability is stated in the diagnostic, never filled by
 * an invented shadow nor by a stretched level that would lower the density of the near shadows.
 *
 * `counting` only adds the two report counters, never a line of physics: the ray, its
 * origin, its bounds and its answer are the same on both sides, character for character. One
 * pass takes them when it can write the proxy; the blend pass cannot, because a storage
 * write in its fragment stage would cost it early depth rejection, and with it the shading
 * of thousands of fragments that depth then discards.
 */
export const sunFarShadowWgsl = (counting: boolean) => `
${BOUNCE_TRACE_WGSL}
fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{
 if(proxy.present<0.5){return 1.0;}
${counting ? ' let counting=proxy.counting>0u;\n if(counting){atomicAdd(&proxy.tested,1u);}\n' : ''} // The ray starts from a proxy cell farther along its own direction: it is this start,
 // not a massive lift along the normal, that skips the coarse surface the point sits on.
 // The lift itself only leaves its exact plane.
 let origin=P+N*proxy.offsetMetres+L*proxy.startMetres;
 if(!proxyBlocked(origin,L,max(proxy.maxMetres-proxy.startMetres,0.0))){return 1.0;}
${counting ? ' if(counting){atomicAdd(&proxy.blocked,1u);}\n' : ''} return 0.0;
}`;
