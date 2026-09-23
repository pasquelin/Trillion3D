import { depthLayerUnits } from '../sdk-core/src/index.ts';
import type { BatchPage } from './clusterBatchRange.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';

/**
 * Sub-batches of coplanar layers, for the WebGL2 path.
 *
 * A primitive instance draws its clusters in one `WEBGL_multi_draw` per material. Clusters
 * the compiler placed on a layer above 0 leave this batch and join a twin batch, same
 * geometry and same index buffer, whose draw record carries that layer's depth offset in
 * hardware units. Ranges of the original batch keep the order they had: only the marked
 * ranges change batch, and nothing else of the scene moves.
 */

/** One twin batch per (instance, layer) encountered. A scene without stacked coplanar
 *  surfaces creates none and draws exactly as before. */
export function buildLayerGroups(
  pages: readonly BatchPage[],
  groups: Array<BatchGroup | undefined>,
) {
  const layerGroups: Array<Map<number, BatchGroup> | undefined> = [];
  for (const page of pages) {
    const layer = page.depthLayer ?? 0;
    // A multi-material has no single bias to carry: the page stays on its original batch.
    if (layer <= 0 || page.material.grouped) continue;
    const base = groups[page.renderOrder];
    if (!base) continue;
    let map = layerGroups[page.renderOrder];
    if (!map) layerGroups[page.renderOrder] = map = new Map();
    if (map.has(layer)) continue;
    const group = new BatchGroup(base.primitive);
    group.transparent = base.transparent;
    group.layer = layer;
    // This path draws with the host-library projection, in FORWARD depth: getting closer
    // to the eye means SUBTRACTING units — the opposite of the engine path.
    group.polygonOffsetUnits = -depthLayerUnits(layer);
    map.set(layer, group);
  }
  return layerGroups;
}

/** The batch that should receive a page: its twin when it carries a layer, otherwise its own. */
export function groupForPage(
  groups: Array<BatchGroup | undefined>,
  layerGroups: Array<Map<number, BatchGroup> | undefined>,
  page: BatchPage,
) {
  const layer = page.depthLayer ?? 0;
  if (layer > 0) {
    const biased = layerGroups[page.renderOrder]?.get(layer);
    if (biased) return biased;
  }
  return groups[page.renderOrder];
}

/** Every batch of a scene: the layer-0 ones and their biased twins. */
export function* everyGroup(
  groups: Array<BatchGroup | undefined>,
  layerGroups: Array<Map<number, BatchGroup> | undefined>,
) {
  for (const group of groups) if (group) yield group;
  for (const map of layerGroups) if (map) for (const group of map.values()) yield group;
}
