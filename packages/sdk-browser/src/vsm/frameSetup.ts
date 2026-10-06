/**
 * Per-frame CPU setup of the virtual shadow maps: the distant-light scheduling, the directional
 * and local light setups, then the id allocation — directional first, then local, then the
 * unreferenced cache entries — and its bookkeeping, then the uploads of the page marking
 * (projection data per id, uniform counts) and of the page address update (the next-map data),
 * into the step-1 resources.
 *
 * Per frame:
 *   vsmInvalidationPhaseFromShadowBoxes(cache, changes)     // scene update, previous frame's ids
 *   const plan = planVirtualShadowFrame(state, lights, camera, viewport)
 *   ... GPU passes (page management, marking, allocation, render, projection) ...
 *   finishVirtualShadowFrame(state, plan)                  // marks rendered, extracts the frame data, swaps
 */
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts';
import { frustumPlanesFromMatrix } from '../../../sdk-core/src/math/frustum/frustum.ts';
import { multiplyMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4.ts';
import { VSM_SINGLE_PAGE_MAP_SLOTS, VSM_PROJECTION_RECORD_BYTES } from './constants.ts';
import { vsmProjectionWords, writeVsmProjectionData } from './projectionData.ts';
import type { VsmResources } from './resources.ts';
import { VSM_UNIFORMS_BYTES, writeVsmUniforms, type VsmFrameUniforms } from './uniforms.ts';
import { vsmWriteChanged } from './writeChanged.ts';
import {
  VsmCacheManager,
  type VsmIdAllocator,
  type VsmNextMap,
  type VsmLightCache,
} from './cacheManager.ts';
import {
  createVsmClipmap,
  type VsmCameraInput,
  type VsmClipmap,
  type VsmViewport,
} from './clipmap.ts';
import { addVsmLocalLightShadow, vsmLocalViewData, type VsmLocalLightSetup } from './localLight.ts';

/** Next-map data stride on the GPU (`VsmNextMap`). */
export const VSM_NEXT_MAP_BYTES = 16;

/** The id half of the shadow map array. */
class VsmMapIds implements VsmIdAllocator {
  /** Single-page slots are always reserved (see `VSM_SINGLE_PAGE_MAP_SLOTS`): full ids start at 8192. */
  mapSlotCount = VSM_SINGLE_PAGE_MAP_SLOTS;
  singlePageMapCount = 0;
  localMaps = 0;
  unseenMaps = 0;
  /** The next-map data count: one past the largest previous id given next data
   *  this frame; the ids below it given none read zero (flags 0 = no caching). */
  nextMapCount = 0;
  /** The previous ids given next data this frame: the first `nextMapIdCount`, in call order. */
  readonly nextMapIds: number[] = [];
  nextMapIdCount = 0;
  /** Each previous id's record, kept across frames (`reset`), this frame's those listed. */
  readonly nextMaps: VsmNextMap[] = [];

  /** Empties the allocator for a new frame, keeping its storage. */
  reset() {
    this.mapSlotCount = VSM_SINGLE_PAGE_MAP_SLOTS;
    this.singlePageMapCount = 0;
    this.localMaps = 0;
    this.unseenMaps = 0;
    this.nextMapCount = 0;
    this.nextMapIdCount = 0;
    return this;
  }

  get fullMapCount() {
    return Math.max(this.mapSlotCount - VSM_SINGLE_PAGE_MAP_SLOTS, 0);
  }
  get mapCount() {
    return this.fullMapCount + this.singlePageMapCount;
  }
  /** Allocates `count` slots of the shadow map array. */
  private allocateMapSlots(singlePage: boolean, count: number) {
    if (singlePage) {
      if (this.singlePageMapCount + count > VSM_SINGLE_PAGE_MAP_SLOTS) return -1;
      const id = this.singlePageMapCount;
      this.singlePageMapCount += count;
      return id;
    }
    const id = this.mapSlotCount;
    this.mapSlotCount += count;
    return id;
  }
  allocateDirectional(count: number) {
    if (this.unseenMaps !== 0 || this.localMaps !== 0)
      throw new Error('VSM: directional maps are allocated first');
    return this.allocateMapSlots(false, count);
  }
  allocateLocal(singlePage: boolean, count: number) {
    if (this.unseenMaps !== 0) throw new Error('VSM: local maps before unreferenced ones');
    this.localMaps += count;
    return this.allocateMapSlots(singlePage, count);
  }
  allocateUnreferenced(singlePage: boolean, count: number) {
    this.unseenMaps += count;
    return this.allocateMapSlots(singlePage, count);
  }
  /** Records a map's next-frame data under its previous id. */
  writeNextMap(prevId: number, data: VsmNextMap) {
    const slot = (this.nextMaps[prevId] ??= {
      flags: 0,
      nextMapId: 0,
      pageShift: [0, 0],
    });
    slot.flags = data.flags;
    slot.nextMapId = data.nextMapId;
    slot.pageShift[0] = data.pageShift[0];
    slot.pageShift[1] = data.pageShift[1];
    this.nextMapIds[this.nextMapIdCount++] = prevId;
    if (prevId >= this.nextMapCount) this.nextMapCount = prevId + 1;
  }
}

/** One scene light handed to the frame. */
export interface VsmFrameLight {
  light: SceneLight;
  /** False when the light is culled this frame (`vsmLightSeen`): its cache entry lives on
   *  unreferenced. */
  visible?: boolean;
}

/** Relative room above what the lighting's f32 range test (`directIncidence`, `distance>=range`)
 *  and the light's f32 position round: a few roundings of 2⁻²⁴ each, far below 2⁻¹⁶. */
const F32_ROOM = 2 ** -16;
const seenClip = new Float64Array(16);
/** The words of a next-data image, made once an image (`planVirtualShadowFrame`). */
const NEXT_WORDS = new WeakMap<ArrayBuffer, { u: Uint32Array<ArrayBuffer>; i: Int32Array }>();
function nextMapWords(image: ArrayBuffer) {
  let words = NEXT_WORDS.get(image);
  if (!words)
    NEXT_WORDS.set(image, (words = { u: new Uint32Array(image), i: new Int32Array(image) }));
  return words;
}

/**
 * The planes every point the frame lights lies within, in world space (`frustum.ts` order): the
 * view's frustum one pixel wider on each side of `width` × `height` — a jittered sample stays
 * within half a pixel of it — and its near plane as much nearer; no far plane where the projection
 * has none. The opaque, blend and water passes read a shadow only at their own pixels (a
 * reflection reads the lit image, bounce traces its proxy): a light no such point is in reach of
 * has no shadow anyone reads.
 */
export function vsmSeenPlanes(
  out: Float64Array,
  view: Float64Array,
  projection: Float64Array,
  width: number,
  height: number,
) {
  multiplyMatrix4(seenClip, projection, view);
  const wider = 1 + 2 / Math.max(1, Math.min(width, height));
  for (let k = 3; k < 16; k += 4) seenClip[k] *= wider;
  frustumPlanesFromMatrix(out, seenClip);
  return out;
}

/** Whether a point within `planes` (`vsmSeenPlanes`) can be in reach of `light`: always for a
 *  sun; for a local light, unless its sphere lies wholly behind one plane. The lighting gives a
 *  point out of range exactly zero before any shadow read (`directIncidence`). */
export function vsmLightSeen(light: SceneLight, planes: Float64Array) {
  if (light.kind === 'directional' || !light.position || !light.range) return true;
  const [x, y, z] = light.position;
  const reach =
    light.range + F32_ROOM * (light.range + Math.max(Math.abs(x), Math.abs(y), Math.abs(z)));
  for (let p = 0; p < 24; p += 4)
    if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -reach)
      return false;
  return true;
}

/** Where each light's maps landed this frame. */
export interface VsmLightAllocation {
  id: string;
  kind: SceneLight['kind'];
  /** First VSM id; the maps are [firstId, firstId + count). */
  firstId: number;
  count: number;
  singlePage: boolean;
  /** Render its pages this frame (always for a clipmap; not fully cached for a local light). */
  shouldRender: boolean;
  entry: VsmLightCache;
  clipmap?: VsmClipmap;
  local?: VsmLocalLightSetup;
}

export interface VsmFramePlan {
  frameStamp: number;
  /** Full + single-page maps with projection data this frame. */
  projectionCount: number;
  fullMapCount: number;
  singlePageMapCount: number;
  mapSlotCount: number;
  /** Referenced lights, directional first then local, in allocation order. */
  lights: VsmLightAllocation[];
  uniforms: VsmFrameUniforms;
  /** The next-map data count: entries uploaded to `resources.nextMaps`. */
  nextMapCount: number;
  /** Map ids exceed the resources' capacity: nothing was uploaded; recreate the resources larger. */
  overflow: boolean;
}

export interface VsmFrameState {
  device: GPUDevice;
  resources: VsmResources;
  cache: VsmCacheManager;
  /** The scene frame number: bumped by every plan. */
  frameStamp: number;
  /** CPU images of the uploads. */
  projectionImage: ArrayBuffer;
  /** Holds the records of the ids `nextMapsHeld` lists (the last frame's), zero elsewhere. */
  nextMapsImage: ArrayBuffer;
  nextMapsHeld: number[];
  nextMapsHeldCount: number;
  uniformsImage: ArrayBuffer;
  /** Last seen shape of each light, for the mobility factor. */
  lightShapes: Map<string, VsmLightShape>;
  /** The id allocator, emptied each frame (`VsmMapIds.reset`). */
  ids: VsmMapIds;
}

/** A light's shape as last seen (its kind and numeric fields), the frame it was last seen and the
 *  mobility factor this frame gave it: compared and rewritten in place, never rebuilt per frame. */
interface VsmLightShape {
  kind: SceneLight['kind'];
  values: Float64Array;
  seen: number;
  mobility: number;
}
const SHAPE_VALUES = 13;

export function createVsmFrameState(
  device: GPUDevice,
  resources: VsmResources,
  cache?: VsmCacheManager,
): VsmFrameState {
  const layout = resources.layout;
  return {
    device,
    resources,
    cache:
      cache ??
      new VsmCacheManager({
        poolPages: layout.poolPages,
        cacheEnabled: layout.staticSlice === 1,
      }),
    frameStamp: 0,
    projectionImage: new ArrayBuffer(layout.mapSlots * VSM_PROJECTION_RECORD_BYTES),
    nextMapsImage: new ArrayBuffer(layout.mapSlots * VSM_NEXT_MAP_BYTES),
    nextMapsHeld: [],
    nextMapsHeldCount: 0,
    uniformsImage: new ArrayBuffer(VSM_UNIFORMS_BYTES),
    lightShapes: new Map(),
    ids: new VsmMapIds(),
  };
}

/** Writes `l`'s shape into `shape`; true when it differs from what it held (NaN for an absent
 *  field, compared as equal to NaN). */
function updateShape(shape: VsmLightShape, l: SceneLight) {
  const v = shape.values;
  let changed = shape.kind !== l.kind;
  shape.kind = l.kind;
  for (let k = 0; k < 3; k++) {
    changed = putShape(v, k, l.position?.[k]) || changed;
    changed = putShape(v, 3 + k, l.direction?.[k]) || changed;
  }
  changed = putShape(v, 6, l.position ? 1 : 0) || changed;
  changed = putShape(v, 7, l.direction ? 1 : 0) || changed;
  changed = putShape(v, 8, l.range) || changed;
  changed = putShape(v, 9, l.coneAngle) || changed;
  changed = putShape(v, 10, l.penumbra) || changed;
  changed = putShape(v, 11, l.emitterRadius) || changed;
  changed = putShape(v, 12, l.castsShadow ? 1 : 0) || changed;
  return changed;
}

/** Writes `x` (NaN when absent) at `k` of `v`; true when it differs from what `v` held. */
function putShape(v: Float64Array, k: number, x: number | undefined) {
  const value = x ?? Number.NaN;
  if (Object.is(v[k], value)) return false;
  v[k] = value;
  return true;
}

// The frame's light lists of `planVirtualShadowFrame`, emptied at each call.
const castingScratch: VsmFrameLight[] = [];
const clipmapScratch: { light: SceneLight; clipmap: VsmClipmap }[] = [];
const localScratch: { light: SceneLight; setup: VsmLocalLightSetup }[] = [];

/** True when a cache entry got no id this frame: the page table is short. */
function anyUnallocated(cache: VsmCacheManager) {
  for (const entry of cache.entries.values()) if (entry.mapId < 0) return true;
  return false;
}

/** Light scene changes (added and removed lights) and mobility: each light's shape is compared
 *  with the one it had, and the cache learns which lights moved. */
function trackLightShapes(state: VsmFrameState, lights: readonly VsmFrameLight[]) {
  const { cache } = state,
    frame = state.frameStamp,
    shapes = state.lightShapes;
  for (const { light } of lights) {
    let shape = shapes.get(light.id);
    if (!shape) {
      shape = {
        kind: light.kind,
        values: new Float64Array(SHAPE_VALUES).fill(Number.NaN),
        seen: 0,
        mobility: 0,
      };
      shapes.set(light.id, shape);
      // A new light is an update whatever its fields.
      shape.kind = '' as SceneLight['kind'];
    }
    shape.seen = frame;
    shape.mobility = updateShape(shape, light) ? 1 : 0;
  }
  cache.dropRemovedLights((id) => shapes.get(id)?.seen !== frame);
  for (const [id, shape] of shapes)
    if (shape.seen !== frame) {
      shapes.delete(id);
      cache.removeLightMobility(id);
    }
  for (const { light } of lights) {
    const shape = shapes.get(light.id)!;
    shape.mobility = cache.updateLightMobility(light.id, shape.mobility === 1);
  }
}

/** The directional lights' shadows: one clipmap each, into `clipmaps`. */
function setupDirectionalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  for (const { light } of casting) {
    if (light.kind !== 'directional' || !light.direction) continue;
    const clipmap = createVsmClipmap(
      state.cache,
      { id: light.id, direction: light.direction },
      camera,
      viewport,
      mobilityOf(light.id),
    );
    clipmapScratch.push({ light, clipmap });
  }
}

/** The local lights' shadows: one setup each, into `locals`. */
function setupLocalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  const views = [vsmLocalViewData(camera, viewport)];
  for (const { light } of casting) {
    if ((light.kind !== 'point' && light.kind !== 'spot') || !light.position || !light.range)
      continue;
    const setup = addVsmLocalLightShadow(
      state.cache,
      {
        id: light.id,
        kind: light.kind,
        position: light.position,
        direction: light.direction,
        range: light.range,
        coneAngle: light.coneAngle,
        innerConeAngle:
          light.coneAngle !== undefined ? light.coneAngle * (1 - (light.penumbra ?? 1)) : undefined,
        sourceRadius: light.emitterRadius,
      },
      views,
      mobilityOf(light.id),
    );
    localScratch.push({ light, setup });
  }
}

/** The id allocation: directional, local, then unreferenced entries. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset();
  const allocations: VsmLightAllocation[] = [];
  for (const { light, clipmap } of clipmapScratch) {
    const entry = clipmap.cacheEntry;
    entry.moveToMapId(ids.allocateDirectional(entry.mapCaches.length));
    allocations.push({
      id: light.id,
      kind: light.kind,
      firstId: entry.mapId,
      count: entry.mapCaches.length,
      singlePage: false,
      shouldRender: true,
      entry,
      clipmap,
    });
  }
  for (const { light, setup } of localScratch) {
    const entry = setup.cacheEntry;
    entry.moveToMapId(ids.allocateLocal(entry.isCachedFarLight(), entry.mapCaches.length));
    allocations.push({
      id: light.id,
      kind: light.kind,
      firstId: entry.mapId,
      count: entry.mapCaches.length,
      singlePage: entry.isCachedFarLight(),
      shouldRender: setup.drawsThisFrame,
      entry,
      local: setup,
    });
  }
  state.cache.carryUnseenLights(ids);
  return { ids, allocations };
}

/** The marking pass's input: every cache entry's projection data at its id, the single-page
 *  maps' records then the full maps', where they changed alone (`vsmWriteChanged`): a still view
 *  and still lights send nothing. */
function uploadProjectionData(state: VsmFrameState, ids: VsmMapIds) {
  const { cache, resources, device } = state,
    image = state.projectionImage;
  for (const entry of cache.entries.values()) {
    const maps = entry.mapCaches;
    for (let index = 0; index < maps.length; index++)
      writeVsmProjectionData(image, entry.mapId + index, maps[index].projectionData);
  }
  const words = vsmProjectionWords(image),
    record = VSM_PROJECTION_RECORD_BYTES / 4,
    full = VSM_SINGLE_PAGE_MAP_SLOTS * record;
  vsmWriteChanged(
    device,
    resources.current.projectionData,
    words,
    0,
    ids.singlePageMapCount * record,
  );
  vsmWriteChanged(
    device,
    resources.current.projectionData,
    words,
    full,
    full + ids.fullMapCount * record,
  );
}

/** The page address update: the next-map data by previous id. The image drops the last frame's
 *  records and takes this frame's: below the count, the words a whole write would send; those that
 *  changed go up (`vsmWriteChanged`). */
function uploadNextMaps(state: VsmFrameState, ids: VsmMapIds) {
  const { u, i } = nextMapWords(state.nextMapsImage),
    held = state.nextMapsHeld;
  for (let j = 0; j < state.nextMapsHeldCount; j++) u.fill(0, held[j] * 4, held[j] * 4 + 4);
  for (let j = 0; j < ids.nextMapIdCount; j++) {
    const id = ids.nextMapIds[j],
      d = ids.nextMaps[id];
    u[id * 4] = d.flags >>> 0;
    i[id * 4 + 1] = d.nextMapId;
    i[id * 4 + 2] = d.pageShift[0];
    i[id * 4 + 3] = d.pageShift[1];
    held[j] = id;
  }
  state.nextMapsHeldCount = ids.nextMapIdCount;
  if (ids.nextMapCount > 0)
    vsmWriteChanged(
      state.device,
      state.resources.nextMaps,
      u,
      0,
      (ids.nextMapCount * VSM_NEXT_MAP_BYTES) / 4,
    );
}

/** The frame's uniform counts. */
function frameUniforms(state: VsmFrameState, ids: VsmMapIds, camera: VsmCameraInput) {
  const uniforms: VsmFrameUniforms = {
    fullMapCount: ids.fullMapCount,
    singlePageMapCount: ids.singlePageMapCount,
    frameStamp: state.frameStamp,
    pressureBias: state.cache.pressureBias,
    // The tangent of the view's half vertical field: the traced read of a blended surface scales
    // its screen ray by it.
    viewTanHalfFovY: 1 / camera.projection[5],
  };
  return uniforms;
}

/**
 * Builds this frame's virtual shadow maps on the CPU and uploads projection data, next data and
 * uniforms into `state.resources` (`current` frame buffers). `lights` is every light of the scene;
 * a light absent from it is removed. Ids past the tables ask
 * `grow` for room for that many full maps: grown, the same frame goes on in the larger tables
 * (the tables are sized per frame); otherwise the plan overflows.
 */
export function planVirtualShadowFrame(
  state: VsmFrameState,
  lights: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  grow?: (fullMapsAsked: number) => boolean,
): VsmFramePlan {
  const { cache, resources, device } = state;
  let layout = resources.layout;
  state.frameStamp++;
  cache.frameStamp = state.frameStamp;
  cache.poolPages = layout.poolPages;
  trackLightShapes(state, lights);
  const mobilityOf = (id: string) => state.lightShapes.get(id)?.mobility ?? 0;
  // The distant light refresh schedule.
  cache.scheduleFarLights();
  const casting = castingScratch;
  casting.length = 0;
  for (const l of lights) if (l.light.castsShadow && (l.visible ?? true)) casting.push(l);
  clipmapScratch.length = 0;
  localScratch.length = 0;
  setupDirectionalLights(state, casting, camera, viewport, mobilityOf);
  setupLocalLights(state, casting, camera, viewport, mobilityOf);
  const { ids, allocations } = allocateLightIds(state);
  const uniforms = frameUniforms(state, ids, camera);
  const fullMaps = Math.max(ids.fullMapCount, ids.nextMapCount - VSM_SINGLE_PAGE_MAP_SLOTS);
  if (fullMaps > layout.fullMapCapacity && grow?.(fullMaps)) layout = resources.layout;
  const plan: VsmFramePlan = {
    frameStamp: state.frameStamp,
    projectionCount: ids.mapCount,
    fullMapCount: ids.fullMapCount,
    singlePageMapCount: ids.singlePageMapCount,
    mapSlotCount: ids.mapSlotCount,
    lights: allocations,
    uniforms,
    nextMapCount: ids.nextMapCount,
    overflow:
      ids.fullMapCount > layout.fullMapCapacity ||
      ids.singlePageMapCount > VSM_SINGLE_PAGE_MAP_SLOTS ||
      anyUnallocated(cache) ||
      ids.nextMapCount > layout.mapSlots,
  };
  if (plan.overflow) return plan;
  uploadProjectionData(state, ids);
  uploadNextMaps(state, ids);
  writeVsmUniforms(state.uniformsImage, layout, uniforms);
  device.queue.writeBuffer(
    resources.current.uniforms,
    0,
    state.uniformsImage,
    0,
    VSM_UNIFORMS_BYTES,
  );
  return plan;
}

/**
 * End of frame, after the GPU work is encoded: every light whose pages were rendered is marked
 * rendered (clipmaps and local lights) — `rendered` false when the raster was skipped —, then the
 * frame data is extracted: the frame's buffers become `resources.prev`.
 */
export function finishVirtualShadowFrame(
  state: VsmFrameState,
  plan: VsmFramePlan,
  rendered = true,
) {
  // A frame whose raster was skipped drew none of the pages it allocated: none may be kept as
  // cached, so every light that should have rendered starts uncached next frame.
  if (!plan.overflow)
    for (const light of plan.lights)
      if (!light.shouldRender) continue;
      else if (rendered) light.entry.markRendered(plan.frameStamp);
      else light.entry.invalidate();
  const hasData = !plan.overflow && plan.projectionCount > 0;
  state.cache.keepFrameForNext(
    hasData
      ? {
          mapSlotCount: plan.mapSlotCount,
          fullMapCount: plan.fullMapCount,
          singlePageMapCount: plan.singlePageMapCount,
        }
      : null,
  );
  // The buffers themselves swap in `keepVsmFrame` (pageManagementPass.ts), called after.
}
