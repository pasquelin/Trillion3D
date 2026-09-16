import * as THREE from 'three';
import { depthLayerUnits } from '../sdk-core/index.ts';
import type { BatchPage } from './clusterBatchRange.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';

/**
 * Sous-lots des couches coplanaires, pour le chemin WebGL2.
 *
 * Une instance de primitive dessine ses clusters en un `WEBGL_multi_draw` par matériau. Les clusters
 * que le compilateur a placés sur une couche supérieure à 0 sortent de ce lot et rejoignent un lot
 * jumeau, même géométrie et même tampon d'index, dont le matériau porte le décalage de profondeur de
 * sa couche en unités matérielles. Les plages du lot d'origine gardent l'ordre qu'elles avaient :
 * seules les plages marquées changent de lot, et rien d'autre de la scène ne bouge.
 */

/** Le matériau d'un sous-lot biaisé : le matériau d'origine, plus le décalage de sa couche. */
function biasedMaterial(material: THREE.Material, layer: number) {
  const clone = material.clone();
  clone.polygonOffset = true;
  clone.polygonOffsetFactor = 0;
  // Ce chemin dessine avec la projection de la bibliothèque hôte, en profondeur DIRECTE : s'y
  // rapprocher de l'œil, c'est RETRANCHER des unités — l'opposé du chemin du moteur.
  clone.polygonOffsetUnits = -depthLayerUnits(layer);
  return clone;
}

/** Un lot jumeau par (instance, couche) rencontrée. Une scène sans surface coplanaire empilée n'en
 *  crée aucun et dessine exactement comme avant. */
export function buildLayerGroups(
  pages: readonly BatchPage[],
  groups: Array<BatchGroup | undefined>,
) {
  const layerGroups: Array<Map<number, BatchGroup> | undefined> = [];
  const materials: THREE.Material[] = [];
  for (const page of pages) {
    const layer = page.depthLayer ?? 0;
    // Un matériau multiple n'a pas de biais unique à porter : la page reste sur son lot d'origine.
    if (layer <= 0 || Array.isArray(page.material)) continue;
    const base = groups[page.renderOrder];
    if (!base) continue;
    let map = layerGroups[page.renderOrder];
    if (!map) layerGroups[page.renderOrder] = map = new Map();
    if (map.has(layer)) continue;
    const group = new BatchGroup(base.primitive);
    group.transparent = base.transparent;
    group.layer = layer;
    group.biased = biasedMaterial(page.material, layer);
    materials.push(group.biased);
    map.set(layer, group);
  }
  return { layerGroups, materials };
}

/** Le lot qui doit recevoir une page : son lot jumeau quand elle porte une couche, sinon le sien. */
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

/** Tous les lots d'une scène : ceux de couche 0 et leurs jumeaux biaisés. */
export function* everyGroup(
  groups: Array<BatchGroup | undefined>,
  layerGroups: Array<Map<number, BatchGroup> | undefined>,
) {
  for (const group of groups) if (group) yield group;
  for (const map of layerGroups) if (map) for (const group of map.values()) yield group;
}
