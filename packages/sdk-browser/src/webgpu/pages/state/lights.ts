import {
  createSceneLightStore,
  createShadowPlan,
  type SceneLightStore,
  type ShadowPlan,
} from '../../../../../sdk-core/src/index.ts';
import { SUN_WINDOW } from '../../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS, type GpuShadowAtlas } from '../../../gpu/shadow/atlas.ts';
import type { GpuShadowCull } from '../../../gpu/shadow/cull.ts';
import type { GpuLightTiles } from '../../../lighting/tiles/tiles.ts';
import { createShadowRuns, type ShadowRuns } from '../../shadow/runs.ts';
import { createShadowRegionList, type ShadowRegionList } from '../../shadow/regions.ts';
import type { CpuCasterLists } from '../../shadow/cpuCasters.ts';
import type { DagLightCut } from '../../../gpu/dag/lightCut.ts';
import type { ShadowPageRequests } from '../../shadow/pageRequests.ts';
import type { ShadowDemand } from '../../shadow/demandPass.ts';
import type { ShadowAllocation } from '../../shadow/allocPass.ts';
import type { DeviceGrant } from '../../../gpu/core/errorScope.ts';
import { createShadowSceneBox } from '../../shadow/sceneBox.ts';
import { createShadowResidence } from '../../shadow/residence.ts';
import { createShadowMobility, type ShadowMobility } from '../../shadow/mobility.ts';
import type { ShadowStaticLayer } from '../../../gpu/shadow/staticLayer.ts';
import type { ShadowPageHiz } from '../../../gpu/shadow/pageHiz.ts';
import type { ShadowOcclusion } from '../../../gpu/shadow/occlusion.ts';
import type { ShadowPageQuads } from '../../../gpu/shadow/pageQuads.ts';
import { createShadowMemory, type ShadowMemory } from '../../shadow/memoryGrant.ts';
import { createShadowWork, type ShadowWork } from '../../shadow/work.ts';

/** Direct-lighting state of the contract: the light store (shared with the host), per-tile lists,
 *  the shadow atlas and the scheduler. Face-matrix buffers are allocated once for a batch. */
export interface WebgpuLightState {
  store: SceneLightStore;
  plan: ShadowPlan;
  buffer: GPUBuffer | undefined;
  tiles: GpuLightTiles | undefined;
  shadows: GpuShadowAtlas | undefined;
  /** The shadow pool's grant, once asked: `settled` once the device granted or refused it. */
  shadowGrant: DeviceGrant | undefined;
  /** The drawing buffer the pool was last sized for; another one resizes it (`poolResize.ts`). */
  poolView: readonly [number, number] | undefined;
  /** The return path of the pages the resolve reads; absent while the pool does not exist. */
  pageRequests: ShadowPageRequests | undefined;
  /** The passes that mark, per pixel, the pages the resolve reads and map them on the GPU
   *  (`../../shadow/demandPass.ts`, `allocPass.ts`). */
  demand: ShadowDemand | undefined;
  allocation: ShadowAllocation | undefined;
  /** Residency flips, compared plan to plan (`../../shadow/residence.ts`). */
  residence: ReturnType<typeof createShadowResidence>;
  /** Which placements move, and the static layer their first move opens. */
  mobility: ShadowMobility;
  /** One word per row, 1 for a moving placement's: what the page cull splits its lists by. */
  mobilityRows: GPUBuffer | undefined;
  /** The static layer of the pool, once an object has moved and its pipeline is built. */
  staticLayer: ShadowStaticLayer | undefined;
  staticLayerPending: boolean;
  /** The static layer's page pyramids and the test of the moving casters against them. */
  pageHiz: ShadowPageHiz | undefined;
  occlusion: ShadowOcclusion | undefined;
  /** The scene's world box, what a sun's depth range and floor span (`../../shadow/sceneBox.ts`). */
  sceneBox: ReturnType<typeof createShadowSceneBox>;
  /** Per-page cull and the world spheres it reads; absent while the pool does not exist. */
  cull: GpuShadowCull | undefined;
  /** Each pass's clears and restores, two instanced draws; made with the atlas. */
  pageQuads: ShadowPageQuads | undefined;
  spheres: { buffer: GPUBuffer; packed: Float32Array<ArrayBuffer>; rows: number } | undefined;
  /** Bind groups of shadow faces, and the resources they were built on. */
  shadowGroups: Array<GPUBindGroup | undefined>;
  shadowGroupsKey: unknown[];
  /** Store revision already pushed to the GPU: an image with no change writes nothing. */
  uploadedEpoch: number;
  /** Matrices of the batch's drawn pages, one per region. */
  faceMatrices: Float32Array;
  /** The batch's drawn light views, one light cut each (`../../shadow/runs.ts`). */
  runs: ShadowRuns;
  /** The batch's regions, one or two per drawn page (`../../shadow/regions.ts`). */
  regions: ShadowRegionList;
  /** The light store slot of each shadow slice, as the image's records were written. */
  shadowSlots: Int32Array;
  /** The threshold the image's light cuts select casters at. */
  shadowPixelError: number;
  /** Image whose shadow pages are planned: a plan is made once per image (`planImageShadows`). */
  plannedFrame: number;
  /** The batch `runs` and `regions` hold, pages `[from, to)` of image `frame`'s plan; −1 once
   *  they no longer do (`../../shadow/pages.ts`). */
  packedBatch: { frame: number; from: number; to: number };
  /** Light views the last image's cuts ran, every batch together; zero on a still frame. */
  lightRuns: number;
  /** The GPU cut seen from the lights, once a frame has drawn a shadow under the GPU cut. */
  lightCut: DagLightCut | undefined;
  /** The casters the CPU cut selected from the light, when it draws the image (`cpuCasters.ts`). */
  cpuCasters: CpuCasterLists | undefined;
  /** Contract lights kept by the last image, and lights with a page drawn by it. */
  lightsActive: number;
  shadowsUpdated: number;
  /** Light views the last image drew in — a sun level, a lamp face at one mip —, a light cut each. */
  shadowFaces: number;
  /** Pages the last image drew: every page it marked, unless a batch could not be encoded. */
  shadowPages: number;
  /** Pages drawn since the state was created, every frame and drain together. */
  shadowPagesTotal: number;
  /** The shadow version (`shadowEpoch`) the still average last took in (`taa/frame.ts`). */
  shadowEpochSeen: number;
  /** Pages the light cut sent back to be drawn again, withdrawn or coarser (`redrawShortPages`). */
  lightCutWithdrawnPages: number;
  lightCutCoarsePages: number;
  /** What the last image's shadow pass drew, apart (`../../shadow/work.ts`). */
  shadowWork: ShadowWork;
  /** Draw calls the shadow pass encoded: per pass its clears and restores, one per region. */
  shadowDrawCalls: number;
  /** Render passes the shadow pass opened: static, pool, transmittance, per layer and batch. */
  shadowRenderPasses: number;
  /** Why the shadow atlas does not exist, when it does not. */
  shadowReason: string | null;
  /** The shadows' fixed memory grant, its peak and its pressure events (`../../shadow/memoryGrant.ts`). */
  memory: ShadowMemory;
  /** The transmittance layer is past the grant or refused: never asked again (`transmittanceGrant.ts`). */
  transmittanceDenied: boolean;
  /** The first contract-lit image's configuration is logged once. */
  firstFrameLogged: boolean;
}

export function createWebgpuLightState(
  poolSide: number,
  store?: SceneLightStore,
  sunWindow = SUN_WINDOW,
): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    plan: createShadowPlan(poolSide, 1, sunWindow),
    buffer: undefined,
    tiles: undefined,
    shadows: undefined,
    shadowGrant: undefined,
    poolView: undefined,
    pageRequests: undefined,
    demand: undefined,
    allocation: undefined,
    sceneBox: createShadowSceneBox(),
    residence: createShadowResidence(),
    mobility: createShadowMobility(),
    mobilityRows: undefined,
    staticLayer: undefined,
    staticLayerPending: false,
    pageHiz: undefined,
    occlusion: undefined,
    cull: undefined,
    pageQuads: undefined,
    spheres: undefined,
    shadowGroups: new Array(2 * MAX_SHADOW_REGIONS).fill(undefined),
    shadowGroupsKey: [],
    uploadedEpoch: 0,
    faceMatrices: new Float32Array(MAX_SHADOW_REGIONS * 16),
    runs: createShadowRuns(),
    regions: createShadowRegionList(poolSide),
    shadowSlots: new Int32Array(0),
    shadowPixelError: 0,
    plannedFrame: -1,
    packedBatch: { frame: -1, from: -1, to: -1 },
    lightRuns: 0,
    lightCut: undefined,
    cpuCasters: undefined,
    lightsActive: 0,
    shadowsUpdated: 0,
    shadowFaces: 0,
    shadowPages: 0,
    shadowPagesTotal: 0,
    shadowEpochSeen: 0,
    lightCutWithdrawnPages: 0,
    lightCutCoarsePages: 0,
    shadowWork: createShadowWork(),
    shadowDrawCalls: 0,
    shadowRenderPasses: 0,
    shadowReason: null,
    memory: createShadowMemory(),
    transmittanceDenied: false,
    firstFrameLogged: false,
  };
}

/** Frees the static layer, its page pyramids and occlusion test: at dispose, or landed after it. */
export function disposeStaticLayer(lights: WebgpuLightState) {
  lights.staticLayer?.dispose();
  lights.pageHiz?.dispose();
  lights.occlusion?.dispose();
  lights.staticLayer = lights.pageHiz = lights.occlusion = undefined;
}

/** The shadow contents' version: the pages the host drew, and those the GPU listed to draw itself
 *  (`listDraw`, known a snapshot late); a change of either is another shadow. */
export const shadowEpoch = (lights: WebgpuLightState) =>
  lights.shadowPagesTotal + lights.plan.gpu.drawn;

/**
 * True while the shadow pages can still change what the image shows: a page stale and read — left
 * by a batch that could not be encoded, or mapped by the GPU and listed for its own draw, not yet
 * drawn (`plan.gpu.listed`, #1344) —, a representation change waiting for the camera to rest,
 * a request report — the shading's, or a light cut's, whose casters may still load, or its flag
 * word — on its way, or no report yet proving that the image reads only pages already drawn. A
 * scene without a shadow light, or an unlit view, reads no page and waits for nothing.
 */
export function shadowsUnsettled(lights: WebgpuLightState) {
  const { plan, store, shadows, pageRequests } = lights;
  if (plan.deferredChanges) return true;
  if (!shadows || !store.count || store.unlit || !plan.records.count) return false;
  if ((pageRequests?.inFlight ?? 0) > 0 || lights.lightCut?.unsettled) return true;
  if (plan.gpu.on && plan.gpu.listed > 0) return true;
  return plan.counts.pendingPages > 0 || !plan.settled(store);
}
