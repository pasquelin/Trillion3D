import type { DirectLightResources } from '../../../lighting/deferred/program.ts';
import type { LitPrograms } from '../../../lighting/deferred/deferred.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { receiverResources } from '../../visibility/receiver.ts';
import { shadowCasterLights } from '../../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/scene/light/contracts.ts';

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

/** The lit programs prepare compiles beside the others when the image wants the contract (#1362),
 *  with bounce too when the session wants it; a failed one is said, then or later. The one it
 *  starts is the one the first frame asks for (`contractKey`), read off the declared lights. */
export const litPrograms = (rt: WebgpuPagesRuntime): LitPrograms => ({
  precompile: wantsContractLighting(rt),
  bounce: rt.bounce.wanted,
  ...contractKey(rt, rt.lights.store.count > LIGHT_SETTINGS.tileLights, true),
  onFailure: (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  unboundedReflections: rt.context.unboundedReflections === true,
});

/**
 * The contract program a frame lights with, keyed on stable state alone (#1362): narrow while the
 * scene's lights fit a tile list (#849), with shadow code while a light declares a shadow and the
 * atlas exists (#1249). Never on a slot held this frame: a lamp that moves, a page that comes and
 * goes, asks no other program. `atlas` is whether the shadow atlas exists, or will at prepare.
 */
function contractKey(rt: WebgpuPagesRuntime, wide: boolean, atlas: boolean) {
  return { narrow: !wide, unshadowed: !atlas || shadowCasterLights(rt.lights.store) === 0 };
}

/** The lit program the frame waits for (#1362): while the image wants the contract and no compiled
 *  program can light it, its compile — never the unlit stand-in meanwhile —, else nothing. */
export function litProgramPending(rt: WebgpuPagesRuntime) {
  const { deferred } = rt.gpu;
  // A lit image already has its program: nothing to read (`deviceAnswering` asks every frame).
  return deferred && !deferred.usesContract && wantsContractLighting(rt)
    ? deferred.awaited(directLightResources(rt))
    : undefined;
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
  // The narrow resolve reads the narrow pass's lists: no tile past its list, no pool (#849); no
  // light declares a shadow, or no atlas holds one: the resolve with no shadow code (#1249).
  const key = contractKey(rt, !lights.tiles || lights.tiles.wide, !!lights.shadows);
  contractResources.narrow = active && key.narrow;
  contractResources.unshadowed = active && key.unshadowed;
  contractResources.slices = active ? lights.shadows?.dataBuffer : undefined;
  contractResources.requests = active ? lights.pageRequests?.buffer : undefined;
  contractResources.atlas = active ? lights.shadows?.view : undefined;
  contractResources.transmittance = active ? lights.shadows?.transmittance : undefined;
  // The grid is bound only if it exists: without it, the deferred pass compiles and binds the
  // contract program alone, exactly the one from before the bounce lot.
  const bounce = active && rt.bounce.wanted ? rt.bounce.probes : undefined;
  contractResources.bounceGrid = bounce?.uniform;
  contractResources.probes = bounce?.probes;
  contractResources.surfaceCache = bounce?.surface.view;
  // Far-shadow proxy: bound only if it exists, else the far surface is lit unshadowed. Both
  // lighting passes read this resolve, so they bind the same buffer and trace the same ray.
  contractResources.proxy = active ? rt.sunFar.gpu?.buffer() : undefined;
  // What the shadow receiver offset is recomputed from: the frame's visibility buffer (#1410).
  contractResources.receiver = active ? receiverResources(rt) : undefined;
  return contractResources;
}
