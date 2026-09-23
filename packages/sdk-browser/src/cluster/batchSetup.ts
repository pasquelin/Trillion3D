import type { BatchPage } from './batchRange.ts';
import type { HostAttributes } from './batchMesh.ts';
import { PrimitiveIndex, BatchGroup } from './batchPrimitive.ts';
import { buildLayerGroups } from './batchLayers.ts';

type PrimitiveDraft = {
  attributes: HostAttributes;
  urls: Map<string, number>;
  lengths: number[];
  urlIndexByPage: number[];
  pages: number;
};

export function setupClusterBatches(pages: readonly BatchPage[]) {
  const state = {
    primitives: [] as PrimitiveIndex[],
    groups: [] as Array<BatchGroup | undefined>,
    layerGroups: [] as Array<Map<number, BatchGroup> | undefined>,
    attributeBytes: 0,
    indexCapacityBytes: 0,
  };
  const drafts = new Map<HostAttributes, PrimitiveDraft>();
  const groupDrafts: Array<{ draft: PrimitiveDraft; transparent: boolean } | undefined> = [];
  for (const page of pages) {
    let draft = drafts.get(page.attributes);
    if (!draft) {
      draft = {
        attributes: page.attributes,
        urls: new Map(),
        lengths: [],
        urlIndexByPage: [],
        pages: 0,
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
    if (!groupDrafts[page.renderOrder])
      groupDrafts[page.renderOrder] = { draft, transparent: !!page.transparent };
  }
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
    );
    built.set(draft, primitive);
    state.primitives.push(primitive);
    state.indexCapacityBytes += primitive.array.byteLength;
    for (const name in draft.attributes) {
      const array = (draft.attributes[name] as { array?: ArrayBufferView } | undefined)?.array;
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
  state.layerGroups = buildLayerGroups(pages, state.groups);
  return state;
}
