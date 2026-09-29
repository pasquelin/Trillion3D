import type { EngineCamera } from '../../../camera/world.ts';
import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../../sdk-core/src/scene/core/environment.ts';
import { uploadSceneLights } from '../state/lightBuffer.ts';
import { planImageShadows } from './encodeShadows.ts';
import { encodeShadowDemand } from '../../shadow/demandPass.ts';
import { encodeShadowAllocation, flushShadowTable } from '../../shadow/allocPass.ts';
import { lightCutMetrics } from '../../shadow/casters.ts';
import { encodeShadowBatches, noteShadowFrame } from './encodeShadowBatches.ts';
import { syncPageProxy, syncLightingProxies } from '../prepare/proxyMotion.ts';
import { ensureBounce } from '../prepare/bounce.ts';
import { ensureSunFarShadow } from '../prepare/sunFar.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The floats the deferred and blend passes reread: lights, tiles in X and Y, exposure, display
 *  curve, then the eye the fog is measured from. */
const directParams = new Float32Array(8);
/** Camera world position, reused from one image to the next: bounce allocates nothing. */
const viewpoint = new Float64Array(3);

/**
 * Direct lighting of an image, in order: shadow scheduling, per-tile light lists, the per-pixel
 * demand of shadow pages and their GPU allocation, depth pass into the atlas and record and table
 * writes, then the parameters deferred resolve will reread. A scene with no declared light
 * launches neither shadows nor lists: it pays nothing, and the unlit view outputs its raw albedo.
 */
export function encodeDirectLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  viewProjection: ArrayLike<number>,
) {
  const { lights } = rt,
    { store, tiles } = lights;
  const active = store.count;
  lights.lightsActive = active;
  lights.lightRuns = 0;
  // Pages this image draws: none unless its batches below say so. A view gone unlit or dark keeps
  // no count of an earlier image, which the still average would restart on (`keepWebgpuFrame`).
  lights.shadowPages = 0;
  const environment = store.environment;
  directParams.fill(0);
  // Exposure is not a light: it sets conversion of radiance into an image, and cannot light anything
  // the declared lights do not already light.
  directParams[3] = environment ? environment.exposure : 1;
  directParams[4] = TONE_MAPPING_RANK[environment?.toneMapping ?? DEFAULT_TONE_MAPPING];
  // The eye itself, under any projection: an orthographic camera's view point is a direction.
  directParams.set(cam.eye, 5);
  // The unlit view reads neither light lists nor an atlas: it therefore encodes none of them.
  // The slices survive it, so a representation change held for the camera to rest is released
  // to the list now: the plan of the first lit frame stales its pages, whatever the camera does.
  if (!active || store.unlit) {
    lights.plan.releaseDeferred();
    // A lit view with no lamp may still hold an environment: its irradiance goes to the GPU.
    if (!store.unlit) uploadSceneLights(device, lights);
    return directParams;
  }
  const pages = planImageShadows(rt, cam);
  // The buffer goes to the GPU before the per-tile lists: the blend pass reads it directly, without
  // tiles, and must stay lit even on a device that could not fit the lists.
  uploadSceneLights(device, lights);
  encodeBounce(rt, device, encoder, active, cam);
  // The sun's far shadow: the proxy is fitted at the first light, like bounce, and its count sample
  // is encoded before the lighting pass that will fill them.
  ensureSunFarShadow(rt, device);
  syncLightingProxies(rt);
  rt.sunFar.gpu?.prepare(encoder, rt.run.frame);
  // The request buffer is zeroed for the demand, then the resolve, to record into. No pool, no
  // shadow light yet: nothing to record (`../../shadow/poolSize.ts`).
  if (lights.shadows?.texture) lights.pageRequests?.clear(encoder);
  const listed = encodeTileLists(rt, encoder, viewProjection, cam.eye);
  // Per pixel, the pages the resolve will read, marked before any page is drawn, and mapped.
  if (listed) encodeShadowDemand(rt, encoder);
  encodeShadowAllocation(rt, encoder);
  // Every page the plan marked is drawn now, batch after batch. A batch may refuse to encode
  // (reject or missing selection): its pages then stay stale, and their table words say what they
  // said — a page is readable only once its draw has landed.
  if (pages) encodeShadowBatches(rt, device, encoder, cam.eye);
  // Records and table words go out after the draws are encoded, before the resolve reads them.
  flushShadowTable(rt, encoder);
  noteShadowFrame(lights);
  if (!listed || !tiles) return directParams;
  directParams[0] = active;
  directParams[1] = tiles.tilesX;
  directParams[2] = tiles.tilesY;
  logFirstDirectFrame(rt);
  return directParams;
}

/** The per-tile light lists of this image, which the demand pass and the resolve read: false when
 *  none could be encoded — no lists, no depth, or a device that could not fit them. */
function encodeTileLists(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  const { lights, gpu } = rt,
    { tiles } = lights,
    [width, height] = gpu.targetSize;
  if (!tiles || !gpu.depthView || !lights.buffer) return false;
  if (!tiles.ensure(width, height, gpu.depthView, lights.buffer, lights.store.count)) return false;
  tiles.update(viewProjection, eye, width, height);
  return tiles.encode(encoder, rt.run.frame);
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
  const probes = bounce.wanted ? bounce.probes : undefined;
  bounce.probesUpdated = 0;
  bounce.raysLaunched = 0;
  bounce.encoded = false;
  // The irradiance diagnostic view outputs raw values: bounce application reads it in the grid
  // uniform, and composition skips ACES and sRGB.
  const irradiance = lights.store.lightingView === 'bounce';
  rt.gpu.deferred?.setRawOutput(irradiance);
  if (!probes) return;
  syncPageProxy(rt, probes);
  probes.setIrradianceView(irradiance);
  // The store revision rises as soon as a light is added, set or removed: that is the only signal
  // the grid needs to restart, and it costs no read. A change of fog alone is not one.
  if (bounce.lightEpoch !== lights.store.transportEpoch) {
    bounce.lightEpoch = lights.store.transportEpoch;
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

/** Configuration of the first image lit by the contract, logged once. */
function logFirstDirectFrame(rt: WebgpuPagesRuntime) {
  const { lights, diag } = rt;
  if (lights.firstFrameLogged) return;
  lights.firstFrameLogged = true;
  diag.engineDiagnostic('direct-lighting-frame', 'First image lit by the contract', {
    version: 1,
    tiles: [lights.tiles?.tilesX ?? 0, lights.tiles?.tilesY ?? 0],
    // The light tiles' depth bounds reduced per subgroup: the device granted `subgroups`.
    tileSubgroups: lights.tiles?.subgroups ?? false,
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
    shadowFaces: lights.shadowFaces,
    shadowDraws: lights.shadowWork.regions,
    shadowPagesDrawn: lights.shadowPages,
    shadowPagesRequested: lights.plan.requests.counts.requested,
    shadowPagesCached: lights.plan.counts.cachedPages,
    shadowPagesInvalidated: lights.plan.counts.invalidatedPages,
    shadowPagesPending: lights.plan.counts.pendingPages,
    shadowPagesOverflow: lights.plan.requests.counts.refused + lights.plan.requests.counts.unlisted,
    shadowWaitMs: lights.plan.counts.waitedMs,
    shadowWaitFrames: lights.plan.counts.waitedFrames,
    ...lightCutMetrics(rt),
    /** Shadow casters past the slices: lit without a shadow (#818, #822). */
    shadowCastersUnsliced: lights.plan.counts.unslicedCasters,
    poolPages: lights.shadows
      ? { used: lights.plan.counts.poolPages, total: lights.plan.pool.pages }
      : null,
    unavailable: lights.shadowReason,
  };
}
