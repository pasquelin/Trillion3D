import {
  SCENE_ENVIRONMENT_FLOATS,
  SCENE_LIGHT_BUFFER_FLOATS,
  createSceneLightStore,
  createShadowPlan,
  type SceneLightStore,
  type ShadowPlan,
} from '../../../../../sdk-core/src/index.ts';
import { MAX_SHADOW_REGIONS, type GpuShadowAtlas } from '../../../gpu/shadow/atlas.ts';
import { ltcTable } from '../../../../../sdk-core/src/lighting/ltcTable.ts';
import type { GpuShadowCull } from '../../../gpu/shadow/cull.ts';
import type { GpuLightTiles } from '../../../lighting/tiles/tiles.ts';
import { createShadowRuns, type ShadowRuns } from '../../shadow/runs.ts';
import type { CpuCasterLists } from '../../shadow/cpuCasters.ts';
import type { DagLightCut } from '../../../gpu/dag/lightCut.ts';

/**
 * Direct-lighting state of the contract: the light store (shared with the host), per-tile lists, the
 * shadow atlas and the scheduler. Face-matrix buffers are allocated once for an image's budget; an
 * image allocates nothing.
 */
export interface WebgpuLightState {
  store: SceneLightStore;
  plan: ShadowPlan;
  buffer: GPUBuffer | undefined;
  tiles: GpuLightTiles | undefined;
  shadows: GpuShadowAtlas | undefined;
  /** Per-face cull and the world spheres it reads; absent while the atlas does not exist. */
  cull: GpuShadowCull | undefined;
  spheres: { buffer: GPUBuffer; packed: Float32Array<ArrayBuffer>; rows: number } | undefined;
  /** Bind groups of shadow faces, and the resources they were built on. */
  shadowGroups: Array<GPUBindGroup | undefined>;
  shadowGroupsKey: unknown[];
  /** Store revision already pushed to the GPU: an image with no change writes nothing. */
  uploadedEpoch: number;
  /** Face matrices of the image, one per updated face. */
  faceMatrices: Float32Array;
  /** The image's redrawn faces, one light cut each (`../../shadow/runs.ts`). */
  runs: ShadowRuns;
  /** Threshold the last light cuts selected at, −1 before the first (`followLightThreshold`). */
  lightThreshold: number;
  /** Image whose shadow regions are planned: a plan is made once per image (`planImageShadows`). */
  plannedFrame: number;
  /** Light cuts the last image ran: one per redrawn face, zero on a still frame. */
  lightRuns: number;
  /** The GPU cut seen from the lights, once a frame has drawn a shadow under the GPU cut. */
  lightCut: DagLightCut | undefined;
  /** The casters the CPU cut selected from the light, when it draws the image (`cpuCasters.ts`). */
  cpuCasters: CpuCasterLists | undefined;
  /** Contract lights kept by the last image, and lights whose map was redrawn. The wait queue and its
   *  lag are read on the scheduler (`plan.counts`). */
  lightsActive: number;
  shadowsUpdated: number;
  /** Faces actually touched by the last image, all regions together. */
  shadowFaces: number;
  /** Redrawn regions and pages they cover: the unit of work and that of the budget. */
  shadowRegions: number;
  shadowPages: number;
  /** Pages drawn since the state was created, every frame and drain together. */
  shadowPagesTotal: number;
  /** Pages redrawn per image, by image rank: the GPU timer comes back late and must find the work of
   *  the image it describes to deduce the cost of a page. */
  pagesByFrame: Uint32Array;
  /** Share of those faces that are sun cascades: the sun's cost, split from punctuals. */
  sunCascades: number;
  shadowDraws: number;
  /** Draw calls actually encoded by the shadow pass: a clear-to-far and an indirect draw per redrawn
   *  face. That is the cost per shadow light. */
  shadowDrawCalls: number;
  /** Why the shadow atlas does not exist, when it does not. */
  shadowReason: string | null;
  /** Configuration of the first image lit by the contract is logged only once. */
  firstFrameLogged: boolean;
}

/** Images kept in the page ring: well beyond the lag of a timestamp sample. */
export const PAGES_RING = 64;

export function createWebgpuLightState(store?: SceneLightStore): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    plan: createShadowPlan(MAX_SHADOW_REGIONS),
    buffer: undefined,
    tiles: undefined,
    shadows: undefined,
    cull: undefined,
    spheres: undefined,
    shadowGroups: new Array(MAX_SHADOW_REGIONS).fill(undefined),
    shadowGroupsKey: [],
    uploadedEpoch: 0,
    faceMatrices: new Float32Array(MAX_SHADOW_REGIONS * 16),
    runs: createShadowRuns(),
    lightThreshold: -1,
    plannedFrame: -1,
    lightRuns: 0,
    lightCut: undefined,
    cpuCasters: undefined,
    lightsActive: 0,
    shadowsUpdated: 0,
    shadowFaces: 0,
    shadowRegions: 0,
    shadowPages: 0,
    shadowPagesTotal: 0,
    pagesByFrame: new Uint32Array(PAGES_RING),
    sunCascades: 0,
    shadowDraws: 0,
    shadowDrawCalls: 0,
    shadowReason: null,
    firstFrameLogged: false,
  };
}

/** Contract light buffer, fixed size — every light slot, the environment's irradiance, then the
 *  fitted lobe of the rectangles, written here once: never reallocated, never indexed beyond. */
export function createSceneLightContractBuffer(device: GPUDevice) {
  const table = ltcTable(),
    fixed = (SCENE_LIGHT_BUFFER_FLOATS + SCENE_ENVIRONMENT_FLOATS) * 4;
  const buffer = device.createBuffer({
    label: 'WG direct lights v1',
    size: fixed + table.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, fixed, table);
  return buffer;
}

/** Pushes the store to the GPU if and only if its revision has changed since the last image. */
export function uploadSceneLights(device: GPUDevice, lights: WebgpuLightState) {
  const { store, buffer } = lights;
  if (!buffer) return false;
  if (lights.uploadedEpoch === store.epoch) return false;
  lights.uploadedEpoch = store.epoch;
  device.queue.writeBuffer(buffer, 0, store.packed);
  // The environment's irradiance sits behind the last light slot (`DirectLights.environment`).
  device.queue.writeBuffer(buffer, SCENE_LIGHT_BUFFER_FLOATS * 4, store.environmentPacked);
  return true;
}

/**
 * Closes the frame's shadow work. A pass that could not be encoded drew nothing: its pages are
 * counted as none, for the frame and for the GPU timer that will number it. What was drawn joins
 * the cumulative total a host reads across frames and settle drains.
 */
export function noteShadowFrame(lights: WebgpuLightState, pagesSlot: number, encoded: boolean) {
  if (!encoded) {
    lights.shadowPages = 0;
    lights.shadowRegions = 0;
    lights.pagesByFrame[pagesSlot] = 0;
  }
  lights.shadowPagesTotal += lights.shadowPages;
}
