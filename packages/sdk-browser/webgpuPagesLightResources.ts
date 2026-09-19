import type { DirectLightResources } from './deferredLightingProgram.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];

/**
 * One more colour tile is resident: the alpha cutout shadow maps read has just changed for every
 * surface that carries this texture, and a map drawn at the previous level would describe foliage
 * that is no longer the image's. All pages therefore go back to waiting, under the ordinary Shadows
 * stage budget. Without this signal, two identical runs produced two different shadows, depending on
 * when each page had been drawn.
 */
export function shadowsFollowTextures(lights: WebgpuLightState) {
  lights.plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
}

/**
 * Serves tiles requested by the previous image, except during a pose barrier: the shadow
 * drain replays the image without admitting new ones. An arriving tile invalidates every
 * map (`shadowsFollowTextures`) and the queue would never empty (#25).
 */
export function pumpResidentTiles(
  textures: { pump: (frame: number) => void } | undefined,
  frame: number,
  converging: boolean,
) {
  if (!converging) textures?.pump(frame);
}

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
  contractResources.tiles = active ? lights.tiles?.buffer : undefined;
  contractResources.slices = active ? lights.shadows?.sliceBuffer : undefined;
  contractResources.atlas = active ? lights.shadows?.view : undefined;
  // The grid is bound only if it exists: without it, the deferred pass compiles and binds the
  // contract program alone, exactly the one from before the bounce lot.
  const bounce = active ? rt.bounce.probes : undefined;
  contractResources.bounceGrid = bounce?.uniform;
  contractResources.probes = bounce?.probes;
  // Far-shadow proxy: bound only if it exists, otherwise the zero replacements leave the far surface
  // lit with no cast shadow. Both lighting passes read this same resolve, so they bind the same
  // buffer and trace the same ray.
  contractResources.proxy = active ? rt.sunFar.gpu?.buffer() : undefined;
  return contractResources;
}
