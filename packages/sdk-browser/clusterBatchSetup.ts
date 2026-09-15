import * as THREE from 'three';
import type { BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import {
  zeroIndirectTexture,
  neutraliseBatchingShader,
  sideSplit,
  type ShaderHook,
} from './clusterBatchMesh.ts';
import { buildLayerGroups } from './clusterBatchLayers.ts';

type PrimitiveDraft = {
  attributes: THREE.BufferGeometry['attributes'];
  urls: Map<string, number>;
  lengths: number[];
  urlIndexByPage: number[];
  pages: number;
  min: [number, number, number];
  max: [number, number, number];
};

export function setupClusterBatches(pages: readonly BatchPage[]) {
  const state = {
    primitives: [] as PrimitiveIndex[],
    groups: [] as Array<BatchGroup | undefined>,
    layerGroups: [] as Array<Map<number, BatchGroup> | undefined>,
    shaderHooks: new Map<THREE.Material, ShaderHook>(),
    ownedMaterials: [] as THREE.Material[],
    attributeBytes: 0,
    indexCapacityBytes: 0,
  };
  const drafts = new Map<THREE.BufferGeometry['attributes'], PrimitiveDraft>();
  const groupDrafts: Array<
    | { draft: PrimitiveDraft; transparent: boolean; material: THREE.Material | THREE.Material[] }
    | undefined
  > = [];
  let maxDraws = 1;
  for (const page of pages) {
    let draft = drafts.get(page.attributes);
    if (!draft) {
      draft = {
        attributes: page.attributes,
        urls: new Map(),
        lengths: [],
        urlIndexByPage: [],
        pages: 0,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      };
      drafts.set(page.attributes, draft);
    }
    let urlIndex = draft.urls.get(page.url);
    if (urlIndex === undefined) {
      urlIndex = draft.lengths.length;
      draft.urls.set(page.url, urlIndex);
      draft.lengths.push(page.triangles * 3);
    }
    if (draft.urlIndexByPage[page.id] === undefined) {
      draft.urlIndexByPage[page.id] = urlIndex;
      draft.pages++;
    }
    for (let axis = 0; axis < 3; axis++) {
      if (page.min[axis] < draft.min[axis]) draft.min[axis] = page.min[axis];
      if (page.max[axis] > draft.max[axis]) draft.max[axis] = page.max[axis];
    }
    if (draft.pages > maxDraws) maxDraws = draft.pages;
    if (!groupDrafts[page.renderOrder])
      groupDrafts[page.renderOrder] = {
        draft,
        transparent: !!page.transparent,
        material: page.material,
      };
  }
  const indirect = zeroIndirectTexture(maxDraws);
  const built = new Map<PrimitiveDraft, PrimitiveIndex>();
  const seen = new Set<ArrayBufferView>();
  for (const draft of drafts.values()) {
    const urlIndexByPage = new Int32Array(draft.urlIndexByPage.length);
    for (let i = 0; i < urlIndexByPage.length; i++)
      urlIndexByPage[i] = draft.urlIndexByPage[i] ?? -1;
    const primitive = new PrimitiveIndex(
      draft.attributes,
      urlIndexByPage,
      Int32Array.from(draft.lengths),
      draft.min,
      draft.max,
    );
    built.set(draft, primitive);
    state.primitives.push(primitive);
    state.indexCapacityBytes += primitive.array.byteLength;
    for (const name in draft.attributes) {
      const array = (draft.attributes[name] as THREE.BufferAttribute | undefined)?.array as
        ArrayBufferView | undefined;
      if (!array || seen.has(array)) continue;
      seen.add(array);
      state.attributeBytes += array.byteLength;
    }
  }
  for (let order = 0; order < groupDrafts.length; order++) {
    const entry = groupDrafts[order];
    if (!entry) continue;
    const group = new BatchGroup(built.get(entry.draft)!);
    group.transparent = entry.transparent;
    state.groups[order] = group;
  }
  // Les deux passes du transparent double face sont figées par primitive : la géométrie est partagée
  // par toutes les instances, donc les deux groupes ne peuvent être posés que si toutes les instances
  // de cette primitive relèvent du même découpage.
  const splitable = new Map<PrimitiveIndex, boolean>();
  for (let order = 0; order < groupDrafts.length; order++) {
    const entry = groupDrafts[order];
    if (!entry) continue;
    const primitive = built.get(entry.draft)!;
    const eligible =
      !Array.isArray(entry.material) &&
      entry.material.transparent === true &&
      entry.material.side === THREE.DoubleSide &&
      entry.material.forceSinglePass !== true;
    splitable.set(primitive, (splitable.get(primitive) ?? true) && eligible);
  }
  const splits = new Map<THREE.Material, [THREE.Material, THREE.Material]>();
  for (let order = 0; order < groupDrafts.length; order++) {
    const entry = groupDrafts[order],
      group = state.groups[order];
    if (!entry || !group || !splitable.get(group.primitive)) continue;
    const original = entry.material as THREE.Material;
    let pair = splits.get(original);
    if (!pair) {
      const made = sideSplit(original);
      if (!made) continue;
      pair = made;
      splits.set(original, pair);
    }
    group.split = pair;
  }
  for (const primitive of state.primitives) {
    if (!splitable.get(primitive)) continue;
    primitive.geometry.addGroup(0, Infinity, 0);
    primitive.geometry.addGroup(0, Infinity, 1);
  }
  const layered = buildLayerGroups(pages, state.groups);
  state.layerGroups = layered.layerGroups;
  state.ownedMaterials = [...splits.values()].flat().concat(layered.materials);
  for (const page of pages)
    for (const material of Array.isArray(page.material) ? page.material : [page.material])
      neutraliseBatchingShader(material, state.shaderHooks);
  for (const material of state.ownedMaterials)
    neutraliseBatchingShader(material, state.shaderHooks);
  return { ...state, indirect };
}
