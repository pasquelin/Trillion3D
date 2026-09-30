import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { writeLampPage } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { footprintDrawn } from '../../../../sdk-core/src/scene/light-shadow/footprint.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import { FOOTPRINT_REACH } from './footprintReach.ts';

/**
 * Composes page `page`'s projection and cull volume into region `region`'s slots. Its casters are
 * those that reach the footprint it is drawn for (`footprint.ts`) — the texels its receivers read,
 * what `commit` records in its word —, grown by the filter's reach: a caster whose widened bounds
 * miss every receiver of the page is not drawn into it (#1211). A page drawn whole culls to its
 * square, as it always did.
 */
export function composePage(
  lights: WebgpuLightState,
  slots: Int32Array,
  page: number,
  region: number,
) {
  const { plan, cull, store, faceMatrices } = lights,
    { pool } = plan;
  const slice = pool.slice[page],
    key = pool.view[page],
    light = store.light(store.ids[slots[slice]])!,
    footprint = footprintDrawn(pool.footprint[page]);
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
          1,
          footprint,
          FOOTPRINT_REACH,
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
          footprint,
          FOOTPRINT_REACH,
        );
  return { light, near: light.kind === 'directional' ? 0 : planes.near };
}
