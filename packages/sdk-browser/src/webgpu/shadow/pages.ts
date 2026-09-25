import { LIGHT_KIND, SHADOW_CULL_FLOATS, writeFace } from '../../../../sdk-core/src/index.ts';
import { writeLampPage } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import {
  SHADOW_PAGE,
  SUN_LEVELS,
  lampFacesOf,
  lampPagesAt,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_PAGES } from '../../gpu/shadow/atlas.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** Six lamp faces, composed the time to write a record or close a run. */
const lampMatrices = new Float32Array(6 * 16),
  scratch = new Float32Array(16);
const slotOf = new Int32Array(64),
  pageXs = new Int32Array(MAX_SHADOW_PAGES),
  pageYs = new Int32Array(MAX_SHADOW_PAGES);

/**
 * Every shadow light's record, the one the shading reads: a lamp's face matrices, a sun's frame,
 * depth range and windows; a slice no light holds reads no shadow. A record is pushed only when
 * one of its numbers changed. Returns the light store slot of each slice, −1 for a free one.
 */
export function writeShadowRecords(lights: WebgpuLightState) {
  const { store, plan, shadows } = lights;
  slotOf.fill(-1);
  if (!shadows) return slotOf;
  for (let slot = 0; slot < store.count; slot++) {
    const slice = store.sliceOf(slot),
      light = slice >= 0 ? store.light(store.ids[slot]) : undefined;
    if (!light) continue;
    slotOf[slice] = slot;
    const base = plan.table.baseOf(slice);
    if (light.kind === 'directional') {
      shadows.writeSun(slice, plan.sun, SUN_LEVELS, base);
      continue;
    }
    const faces = lampFacesOf(LIGHT_KIND[light.kind]);
    let planes = { near: 0, halfFov: 0 };
    for (let face = 0; face < faces; face++)
      planes = writeFace(lampMatrices, face * 16, null, 0, light, face);
    shadows.writeLamp(slice, lampMatrices, faces, Math.tan(planes.halfFov), planes.near, base);
  }
  for (let slice = 0; slice < slotOf.length; slice++)
    if (slotOf[slice] < 0) shadows.clearRecord(slice);
  return slotOf;
}

/** How each page of the batch is drawn (`DRAW_*`), in admission order: what `commit` records. */
export const pageModes = new Uint8Array(MAX_SHADOW_PAGES);
/** The run — the light cut's view — each page of the batch is drawn in, in admission order. */
export const pageViews = new Uint8Array(MAX_SHADOW_PAGES);

/** Composes page `page`'s projection and cull volume into region `region`'s slots. */
function composePage(lights: WebgpuLightState, slots: Int32Array, page: number, region: number) {
  const { plan, cull, store, faceMatrices } = lights,
    { pool } = plan;
  const slice = pool.slice[page],
    key = pool.view[page],
    light = store.light(store.ids[slots[slice]])!;
  const planes =
    light.kind === 'directional'
      ? writeSunSquare(
          faceMatrices,
          region * 16,
          cull!.volumes,
          region * SHADOW_CULL_FLOATS,
          plan.sun,
          slice,
          key,
          pool.x[page],
          pool.y[page],
        )
      : writeLampPage(
          faceMatrices,
          region * 16,
          cull!.volumes,
          region * SHADOW_CULL_FLOATS,
          light,
          key >> 4,
          key & 15,
          pool.x[page],
          pool.y[page],
        );
  return { light, near: light.kind === 'directional' ? 0 : planes.near };
}

/**
 * Pages `[from, to)` of the frame's list — one batch (`admit.ts`, `batchEnd`) —, as the depth pass
 * draws them: each page's regions (`regions.ts`) — its matrix, its own projection, and cull volume,
 * the physical page its viewport lands on —, and the runs its light cuts select in, one per light
 * view, the pages of a view contiguous, at the image's records (`shadowSlots`) and threshold
 * (`shadowPixelError`). Returns the regions.
 *
 * The batch composed last is kept (`packedBatch`): the CPU cut composes every batch to select its
 * casters, then the depth pass composes them again to draw, and a frame of one batch — the most a
 * frame drew before #489 — finds it composed and composes it once, as it did.
 */
export function writeShadowPages(
  lights: WebgpuLightState,
  origin: ArrayLike<number>,
  from: number,
  to: number,
) {
  const { plan, shadows, cull, runs, regions, faceMatrices, packedBatch } = lights,
    { pool, admission } = plan;
  if (
    packedBatch.frame === lights.plannedFrame &&
    packedBatch.from === from &&
    packedBatch.to === to
  )
    return regions.count;
  packedBatch.frame = -1;
  runs.reset();
  regions.reset();
  if (!shadows || !cull) return 0;
  const slots = lights.shadowSlots,
    pixelError = lights.shadowPixelError;
  const { list, keys } = admission;
  let open = -1;
  for (let i = from; i < to; i++) {
    const page = list[i],
      region = regions.count;
    const fresh = open < 0 || keys[i] !== keys[open];
    if (fresh && open >= 0) close(lights, slots, open, i, origin, pixelError);
    const { light, near } = composePage(lights, slots, page, region);
    const mode = (pageModes[i - from] = pool.drawMode(page, !!lights.staticLayer));
    const taken = regions.push(page, mode, cull.volumes, cull.volumeWords);
    for (let k = 0; k < taken; k++) {
      if (k) faceMatrices.copyWithin((region + k) * 16, region * 16, region * 16 + 16);
      shadows.writePage(
        region + k,
        faceMatrices,
        (region + k) * 16,
        page,
        light.position,
        light.emitterRadius ?? 0,
      );
    }
    if (fresh) {
      runs.open(region, near);
      open = i;
    }
    pageViews[i - from] = runs.count - 1;
    runs.add(pool.x[page], pool.y[page], taken);
  }
  if (open >= 0) close(lights, slots, open, to, origin, pixelError);
  packedBatch.frame = lights.plannedFrame;
  packedBatch.from = from;
  packedBatch.to = to;
  return regions.count;
}

/** Closes the open run, pages `[from, to)` of the frame's list: composes its window, then its
 *  selection. */
function close(
  lights: WebgpuLightState,
  slots: Int32Array,
  from: number,
  to: number,
  origin: ArrayLike<number>,
  pixelError: number,
) {
  const { plan, runs, store } = lights,
    { pool, sun } = plan,
    list = plan.admission.list,
    page = list[from],
    slice = pool.slice[page],
    key = pool.view[page];
  const run = runs.list[runs.count - 1];
  const sunLevel = plan.records.kind[slice] === LIGHT_KIND.directional;
  const pages = sunLevel ? 0 : lampPagesAt(key & 15);
  runs.shape(sunLevel ? Math.max(run.x1 - run.x0, run.y1 - run.y0) + 1 : pages);
  const cells = 8 << run.shift;
  if (sunLevel) writeSunSquare(scratch, 0, null, 0, sun, slice, key, run.x0, run.y0, cells);
  else writeFace(scratch, 0, null, 0, store.light(store.ids[slots[slice]])!, key >> 4);
  for (let i = from; i < to; i++) {
    pageXs[i - from] = pool.x[list[i]] - (sunLevel ? run.x0 : 0);
    pageYs[i - from] = pool.y[list[i]] - (sunLevel ? run.y0 : 0);
  }
  const side = (sunLevel ? cells : pages) * SHADOW_PAGE;
  runs.close(
    origin,
    pixelError,
    side,
    sunLevel ? 8 : Math.min(8, pages),
    pageXs,
    pageYs,
    to - from,
  );
}
