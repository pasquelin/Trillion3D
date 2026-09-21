import type { EngineCamera } from './cameraWorld.ts';
import { PAGES_RING, noteShadowFrame, uploadSceneLights } from './webgpuPagesStateLights.ts';
import { planShadowRegions } from './webgpuPagesEncodeShadows.ts';
import { encodeShadowAtlas } from './webgpuPagesEncodeShadowPass.ts';
import { ensureBounce } from './webgpuPagesPrepareBounce.ts';
import { ensureSunFarShadow } from './webgpuPagesPrepareSunFar.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The four floats the deferred pass rereads: lights, tiles in X and Y, exposure. */
const directParams = new Float32Array(4);
/** Camera world position, reused from one image to the next: bounce allocates nothing. */
const viewpoint = new Float64Array(3);

/**
 * Direct lighting of an image, in order: shadow scheduling and matrix writes, depth pass into the
 * atlas, per-tile light lists, then the parameters deferred resolve will reread. A scene with no
 * declared light launches neither shadows nor lists: it pays nothing, and the unlit view outputs its
 * raw albedo.
 */
export function encodeDirectLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  inverseViewProjection: ArrayLike<number>,
) {
  const { lights, gpu } = rt,
    { store, tiles } = lights,
    [width, height] = gpu.targetSize;
  const active = store.count;
  lights.lightsActive = active;
  const environment = store.environment;
  directParams.fill(0);
  // Exposure is not a light: it sets conversion of radiance into an image, and cannot light anything
  // the declared lights do not already light.
  directParams[3] = environment ? environment.exposure : 1;
  // The unlit view reads neither light lists nor an atlas: it therefore encodes none of them.
  // The slices survive it, so a representation change held for the camera to rest is released
  // to the list now: the plan of the first lit frame stales its pages, whatever the camera does.
  if (!active || store.unlit) {
    lights.plan.releaseDeferred();
    return directParams;
  }
  const frame = rt.run.frame,
    nowMs = performance.now(),
    pagesSlot = frame % PAGES_RING;
  const regions = planShadowRegions(rt, cam, frame, nowMs);
  // The pass timer comes back late: the image must leave behind how many pages it redrew, or the
  // sample would not know what it is numbering.
  lights.pagesByFrame[pagesSlot] = lights.shadowPages;
  // The buffer goes to the GPU before the per-tile lists: the blend pass reads it directly, without
  // tiles, and must stay lit even on a device that could not fit the lists.
  uploadSceneLights(device, lights);
  encodeBounce(rt, device, encoder, active, cam);
  // The sun's far shadow: the proxy is fitted at the first light, like bounce, and its count sample
  // is encoded before the lighting pass that will fill them.
  ensureSunFarShadow(rt, device);
  rt.sunFar.gpu?.prepare(encoder, rt.run.frame);
  // The pass may refuse to encode (reject or missing selection): pages the scheduler just took out
  // of the queue then go back in, or their map would keep a stale depth with nothing saying so.
  // Their held-page mask, pushed with the plan, says "held" for this one frame; `reissue`
  // gives them back what they held before, and the next plan pushes that mask.
  const encoded = !regions || encodeShadowAtlas(rt, device, encoder, regions);
  if (!encoded) lights.plan.reissue(frame, nowMs);
  noteShadowFrame(lights, pagesSlot, encoded);
  if (!tiles || !gpu.depthView) return directParams;
  if (!tiles.ensure(width, height, gpu.depthView)) return directParams;
  tiles.update(inverseViewProjection, width, height, active);
  if (!tiles.encode(encoder)) return directParams;
  directParams[0] = active;
  directParams[1] = tiles.tilesX;
  directParams[2] = tiles.tilesY;
  logFirstDirectFrame(rt);
  return directParams;
}

/** Light tiles of this image, which the blend pass rereads: zero tiles when no list was encoded,
 *  never those of another image. */
export const directTiles = () => directParams;

/**
 * An irradiance-probe batch, when there is work. The grid rereads the light buffer that was just
 * pushed, so bounce follows a moving light without one extra image of lag. A scene where nothing
 * changed and whose grid is converged encodes nothing at all: the Bounce stage is then "unmeasured",
 * never zero.
 */
function encodeBounce(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  active: number,
  cam: EngineCamera,
) {
  const { bounce, lights } = rt;
  // A light exists: that is the signal that triggers the resident-proxy read, once.
  ensureBounce(rt, device);
  const probes = bounce.probes;
  bounce.probesUpdated = 0;
  bounce.raysLaunched = 0;
  bounce.encoded = false;
  // The irradiance diagnostic view outputs raw values: bounce application reads it in the grid
  // uniform, and composition skips ACES and sRGB.
  const irradiance = lights.store.lightingView === 'bounce';
  rt.gpu.deferred?.setRawOutput(irradiance);
  if (!probes) return;
  probes.setIrradianceView(irradiance);
  // The store revision rises as soon as a light is added, set or removed: that is the only signal
  // the grid needs to restart, and it costs no read.
  if (bounce.lightEpoch !== lights.store.epoch) {
    bounce.lightEpoch = lights.store.epoch;
    probes.restart();
  }
  // Camera world position, posted by image entry: cascades re-centre on it by cell step. No
  // allocation, and nothing else of the camera enters bounce — neither its direction nor its view
  // frustum: a pivoting camera would then invalidate nothing useful.
  viewpoint.set(cam.eye);
  bounce.encoded = probes.encode(encoder, active, viewpoint);
  bounce.probesUpdated = probes.lastProbes;
  bounce.raysLaunched = probes.lastRays;
}

/** Bounce state, as the image diagnostics and the per-stage profile publish it. */
export function bounceState(rt: WebgpuPagesRuntime) {
  const { bounce } = rt,
    probes = bounce.probes;
  return {
    probes: probes?.cascades.probes ?? null,
    probesUpdated: bounce.probesUpdated,
    rays: bounce.raysLaunched,
    budgetLoad: probes?.budget.load ?? null,
    budgetLastMs: probes?.budget.lastMs ?? null,
    converged: probes ? !probes.working : null,
    unavailable: bounce.reason,
  };
}

/** Configuration of the first image lit by the contract, logged once. */
function logFirstDirectFrame(rt: WebgpuPagesRuntime) {
  const { lights, diag } = rt;
  if (lights.firstFrameLogged) return;
  lights.firstFrameLogged = true;
  diag.engineDiagnostic('direct-lighting-frame', 'First image lit by the contract', {
    version: 1,
    tiles: [lights.tiles?.tilesX ?? 0, lights.tiles?.tilesY ?? 0],
    ...directLightingState(rt),
  });
}

/** Direct-lighting state, as the image and tracking diagnostics publish it. */
export function directLightingState(rt: WebgpuPagesRuntime) {
  const { lights } = rt;
  return {
    contractLights: lights.lightsActive,
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    shadowsUpdated: lights.shadowsUpdated,
    sunShadowsUpdated: lights.plan.counts.sunLights,
    shadowsReused: lights.plan.counts.reused,
    shadowFaces: lights.shadowFaces,
    sunCascades: lights.sunCascades,
    shadowDraws: lights.shadowDraws,
    shadowRegions: lights.shadowRegions,
    shadowPagesDrawn: lights.shadowPages,
    shadowPagesInvalidated: lights.plan.counts.invalidatedPages,
    shadowPagesPending: lights.plan.counts.pendingPages,
    shadowWaitMs: lights.plan.counts.waitedMs,
    shadowWaitFrames: lights.plan.counts.waitedFrames,
    shadowBudgetMs: lights.plan.budget.budgetMs,
    shadowMsPerPage: lights.plan.budget.msPerPage,
    shadowsDenied: lights.plan.counts.denied,
    atlasCells: lights.shadows ? lights.plan.slices.atlas.occupancy() : null,
    unavailable: lights.shadowReason,
  };
}
