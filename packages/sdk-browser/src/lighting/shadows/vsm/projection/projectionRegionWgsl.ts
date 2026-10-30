/**
 * The projection's region pieces (`projectionWgsl.ts`): the region test of a light at a pixel and the
 * light a subsurface receiver lets through its shadow.
 */
import type { VsmInputType } from '../inputType.ts'

/** The light's region test (the receiver's trace: `../trace/receiverTraceWgsl.ts`) of the surfaces. */
export const VSM_PROJECTION_REGION_WGSL = /* wgsl */ `/** The region test: whether light k shades the pixel at all (in the view rect, a lit surface,
 *  where the lighting gives the light energy — localLightReaches —, not back-facing where the
 *  frame culls back-facing pixels, shadowCullBackfacingPixels, and the surface is neither a subsurface
 *  one nor a clear-coated one). */
fn vsmLightParticipates(k:u32,info:VsmSurfaceInfo,shiftedPositionIn:vec3f)->bool{
 if(!info.valid){return false;}
 let light=vsmView.lights[k];
 let backfaceCull=vsm.cullBackfacing!=0u&&!info.subsurface&&!info.coated;
 if(light.kind==LIGHT_KIND_DIRECTIONAL){
  return !(backfaceCull&&vsmFacesAwayFromSun(info.worldNormal,light.direction,light.sourceRadius));
 }
 let toLight=light.shiftedPosition-shiftedPositionIn;
 if(!localLightReaches(toLight,light.radius,light.cosCone,-light.direction,light.kind==LIGHT_KIND_RECT)){return false;}
 return !(backfaceCull&&vsmFacesAwayFromLocal(toLight,info.worldNormal,light.sourceRadius));
}
`

/** The light's region test of a strand (`../inputType.ts`): where the lighting gives the light energy, no
 *  back face culled — a strand has none —, as the reference spares its hair input. */
const STRANDS_REGION_WGSL = /* wgsl */ `/** The region test of a strand: whether light k reaches it (localLightReaches; a sun always). */
fn vsmLightParticipates(k:u32,info:VsmSurfaceInfo,shiftedPositionIn:vec3f)->bool{
 if(!info.valid){return false;}
 let light=vsmView.lights[k];
 if(light.kind==LIGHT_KIND_DIRECTIONAL){return true;}
 let toLight=light.shiftedPosition-shiftedPositionIn;
 return localLightReaches(toLight,light.radius,light.cosCone,-light.direction,light.kind==LIGHT_KIND_RECT);
}
`

/** The region test of the pixels of `input`; with `culled` false, the surfaces' too leave out the back-face cull (the overdraw view counts the raster's draws, which the cull does not touch). */
export const vsmProjectionRegionWgsl = (input: VsmInputType, culled = true) =>
  input === 'strands' || !culled ? STRANDS_REGION_WGSL : VSM_PROJECTION_REGION_WGSL

/** The subsurface receiver's piece of a trace. */
export const VSM_PROJECTION_SUBSURFACE_WGSL = /* wgsl */ `/** The share of a light a subsurface receiver (info.opacity) lets through its shadow: where the
 *  trace was shadowed at all, the light that travels the mean distance its rays were stopped at
 *  through the material — e^(−distance · density), the density of the opacity: −0.05 · ln(1 − opacity)
 *  per centimetre, or a toon pixel's profile's extinction — added to the share its rays missed, and squared, as the shadow factor of the
 *  reference is for consistency with its square-rooted mask. */
fn vsmSubsurfaceShadow(r:VsmTraceResult,info:VsmSurfaceInfo)->VsmTraceResult{
 if(info.opacity<0.0||r.rayCount==0u||r.shadowFactor>=1.0){return r;}
 let density=select(subsurfaceDensity(info.opacity),info.extinction,info.toon);
 let transmission=saturate(exp(-r.occluderDistance*VSM_CM_PER_UNIT*density));
 let through=mix(transmission,1.0,r.shadowFactor);
 var q=r;
 q.shadowFactor=through*through;
 return q;
}
`
