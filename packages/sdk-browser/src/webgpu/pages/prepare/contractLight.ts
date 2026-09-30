import type { DirectLightResources } from '../../../lighting/deferred/program.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * True when the image must be lit by the declared lights. False in the only unlit view: `unlit`
 * requested by the host, or `auto` on a scene with no light — there, raw albedo comes out as-is.
 *
 * The light count does not enter the decision. An explicitly requested `lit` view lights even with
 * no light: the contract then outputs black, emissives kept, and that is the right answer — a scene
 * no source lights is black. Falling back to albedo made a room bright when the host had just turned
 * off all its lights, with no blackout showing.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  return !rt.lights.store.unlit;
}

/** Whether the image can hold an as-is pixel: a row showed a surface as-is, or a diagnostic view
 *  writes the flag. Otherwise every share is 0, and TAA and composition read no flags (OMB-11). */
export const readsAsIs = ({ vis, run }: WebgpuPagesRuntime) =>
  vis.asIsShown || run.diagnostic !== 'beauty';

/** The deferred lighting while the image wants the contract but still resolves unlit — its
 *  program compiles, and its arrival changes the image —, else nothing. */
export function compilingContract(rt: WebgpuPagesRuntime) {
  const { deferred } = rt.gpu;
  return deferred && wantsContractLighting(rt) && !deferred.usesContract ? deferred : undefined;
}

const contractResources: DirectLightResources = {};

/**
 * Contract resources the deferred pass binds, or nothing when they do not exist. Each is returned as
 * it is held elsewhere, never copied or rebuilt: the pass compares what it is given to what it has
 * bound, and rebuilds its bind group only if that has changed. The object itself is reused from one
 * image to the next: the pass allocates nothing.
 */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    active = wantsContractLighting(rt);
  contractResources.lights = lights.buffer;
  contractResources.tiles = active ? lights.tiles?.buffer : undefined;
  // The narrow resolve reads the narrow pass's lists: no tile past its list, no pool (#849).
  contractResources.narrow = active && !!lights.tiles && !lights.tiles.wide;
  contractResources.slices = active ? lights.shadows?.dataBuffer : undefined;
  contractResources.requests = active ? lights.pageRequests?.buffer : undefined;
  contractResources.atlas = active ? lights.shadows?.view : undefined;
  contractResources.transmittance = active ? lights.shadows?.transmittance : undefined;
  // The grid is bound only if it exists: without it, the deferred pass compiles and binds the
  // contract program alone, exactly the one from before the bounce lot.
  const bounce = active && rt.bounce.wanted ? rt.bounce.probes : undefined;
  contractResources.bounceGrid = bounce?.uniform;
  contractResources.probes = bounce?.probes;
  contractResources.surfaceCache = bounce?.surface.buffer;
  // Far-shadow proxy: bound only if it exists, else the far surface is lit unshadowed. Both
  // lighting passes read this resolve, so they bind the same buffer and trace the same ray.
  contractResources.proxy = active ? rt.sunFar.gpu?.buffer() : undefined;
  return contractResources;
}
