import { LIGHT_KIND, SHADOW_CULL_FLOATS, writeFace } from '../../../../sdk-core/src/index.ts';
import { writeLampPage } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import {
  POOL_PAGES,
  POOL_SIDE,
  SHADOW_PAGE,
  SUN_LEVELS,
  lampFacesOf,
  lampPagesAt,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** Six lamp faces, composed the time to write a record or close a run. */
const lampMatrices = new Float32Array(6 * 16),
  scratch = new Float32Array(16);
const slotOf = new Int32Array(64),
  pageXs = new Int32Array(MAX_SHADOW_REGIONS),
  pageYs = new Int32Array(MAX_SHADOW_REGIONS),
  keys = new Float64Array(POOL_PAGES);
/** Per drawn page: the scissor that bounds it and the viewport it lands on — the same square, the
 *  physical page, `x, y, side`. */
export const regionViewport = new Int32Array(MAX_SHADOW_REGIONS * 3);

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

/**
 * The frame's pages, as the depth pass draws them: each page's matrix — its own projection — and
 * cull volume, the physical page its viewport lands on, and the runs its light cuts select in —
 * one per light view, the pages of a view contiguous. Returns the pages written.
 */
export function writeShadowPages(
  lights: WebgpuLightState,
  slots: Int32Array,
  origin: ArrayLike<number>,
  pixelError: number,
) {
  const { plan, shadows, cull, runs, store, faceMatrices } = lights,
    { pool, sun, admission } = plan;
  runs.reset();
  if (!shadows || !cull) return 0;
  const count = admission.count,
    list = admission.list;
  for (let i = 0; i < count; i++) keys[list[i]] = pool.slice[list[i]] * 4096 + pool.view[list[i]];
  list.subarray(0, count).sort((a, b) => keys[a] - keys[b] || a - b);
  let open = -1;
  for (let region = 0; region < count; region++) {
    const page = list[region],
      slice = pool.slice[page],
      key = pool.view[page];
    const light = store.light(store.ids[slots[slice]])!;
    const isSun = light.kind === 'directional';
    if (open >= 0 && keys[page] !== keys[list[open]])
      close(lights, slots, list[open], origin, pixelError);
    const planes = isSun
      ? writeSunSquare(
          faceMatrices,
          region * 16,
          cull.volumes,
          region * SHADOW_CULL_FLOATS,
          sun,
          slice,
          key,
          pool.x[page],
          pool.y[page],
        )
      : writeLampPage(
          faceMatrices,
          region * 16,
          cull.volumes,
          region * SHADOW_CULL_FLOATS,
          light,
          key >> 4,
          key & 15,
          pool.x[page],
          pool.y[page],
        );
    if (open < 0 || keys[page] !== keys[list[open]]) {
      runs.open(region, isSun ? 0 : planes.near);
      open = region;
    }
    runs.add(pool.x[page], pool.y[page]);
    shadows.writePage(
      region,
      faceMatrices,
      region * 16,
      page,
      light.position,
      light.emitterRadius ?? 0,
    );
    regionViewport[region * 3] = (page % POOL_SIDE) * SHADOW_PAGE;
    regionViewport[region * 3 + 1] = Math.floor(page / POOL_SIDE) * SHADOW_PAGE;
    regionViewport[region * 3 + 2] = SHADOW_PAGE;
  }
  if (open >= 0) close(lights, slots, list[open], origin, pixelError);
  shadows.flushPages(count);
  lights.shadowFaces = runs.count;
  lights.shadowsUpdated = plan.counts.lights;
  return count;
}

/** Closes the open run, whose first page is `page`: composes its window, then its selection. */
function close(
  lights: WebgpuLightState,
  slots: Int32Array,
  page: number,
  origin: ArrayLike<number>,
  pixelError: number,
) {
  const { plan, runs, store } = lights,
    { pool, sun } = plan,
    slice = pool.slice[page],
    key = pool.view[page];
  const run = runs.list[runs.count - 1];
  const list = plan.admission.list;
  let side: number, rows: number;
  if (plan.records.kind[slice] === LIGHT_KIND.directional) {
    runs.shape(Math.max(run.x1 - run.x0, run.y1 - run.y0) + 1);
    const cells = 8 << run.shift;
    writeSunSquare(scratch, 0, null, 0, sun, slice, key, run.x0, run.y0, cells);
    side = cells * SHADOW_PAGE;
    rows = 8;
    for (let i = 0; i < run.count; i++) {
      pageXs[i] = pool.x[list[run.first + i]] - run.x0;
      pageYs[i] = pool.y[list[run.first + i]] - run.y0;
    }
  } else {
    const pages = lampPagesAt(key & 15);
    runs.shape(pages);
    writeFace(scratch, 0, null, 0, store.light(store.ids[slots[slice]])!, key >> 4);
    side = pages * SHADOW_PAGE;
    rows = Math.min(8, pages);
    for (let i = 0; i < run.count; i++) {
      pageXs[i] = pool.x[list[run.first + i]];
      pageYs[i] = pool.y[list[run.first + i]];
    }
  }
  runs.close(origin, pixelError, side, rows, pageXs, pageYs);
}
