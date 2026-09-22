import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type Primitive,
} from '../../../sdk-core/index.ts';
import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import type { Cut } from './worldCuts.ts';
import type { Batch } from './worldBatches.ts';
import type { MaterialEntry } from './worldMaterials.ts';
import { buildWorldMirror } from './worldMirror.ts';
import type { LoadedModel } from './loadedModel.ts';

/** A page's addresses made absolute against the manifest they were read from. */
function absolutePrimitive(primitive: Primitive, base: string, mesh: number): Primitive {
  const at = (url: string) => new URL(url, base).href;
  return {
    ...primitive,
    mesh,
    pages: primitive.pages.map((page) => ({
      ...page,
      url: at(page.url),
      ...(page.geometry ? { geometry: { ...page.geometry, url: at(page.geometry.url) } } : {}),
    })),
    streams: primitive.streams
      ? {
          ...primitive.streams,
          pages: primitive.streams.pages.map((b) => ({ ...b, url: at(b.url) })),
        }
      : primitive.streams,
  };
}

/** What a session is opened on: the batches placed by rows, the meshes drawn whole, the models. */
export type WorldPlan = {
  batches: readonly Batch[];
  whole: readonly { node: Object3D; cut: Cut; entry: MaterialEntry }[];
  models: readonly LoadedModel[];
};

/**
 * The scene a world's session opens on: one manifest merging the loaded models' (their page
 * addresses made absolute, their mesh ranks moved past each other's) and one primitive per
 * geometry resource, and the host graph that places them (`buildWorldMirror`). The first model
 * lends the session its base — its baked texture levels, its resident proxy, its declared
 * lights. Null when nothing is drawn.
 */
export function buildWorldSource(plan: WorldPlan) {
  const { batches, whole, models } = plan;
  const primitives: Primitive[] = [];
  const associations = new Map<object, { meshes?: number; primitives?: number }>();
  let offset = 0;
  for (const model of models) {
    const { metadata, base, scene: graph } = model.record;
    for (const primitive of metadata.primitives)
      primitives.push(absolutePrimitive(primitive, base, primitive.mesh + offset));
    for (const [node, link] of graph.associations)
      associations.set(node, { ...link, meshes: (link.meshes ?? 0) + offset });
    offset += Math.max(-1, ...metadata.primitives.map((p) => p.mesh)) + 1;
  }
  // One primitive per geometry resource, however many batches wear it and rows place it.
  const ranks = new Map<Cut, number>();
  const rankOf = (cut: Cut) => {
    let rank = ranks.get(cut);
    if (rank === undefined) {
      ranks.set(cut, (rank = offset++));
      primitives.push({ ...cut.runtime.primitive, mesh: rank });
    }
    return rank;
  };
  if (!primitives.length && !batches.length && !whole.length) return null;
  const mirror = buildWorldMirror({
    placed: batches.map((batch) => ({
      cut: batch.cut,
      material: batch.entry.material,
      rows: batch.rows!,
      name: batch.entry.material.name as string,
    })),
    whole: whole.map(({ node, cut, entry }) => ({ node, cut, material: entry.material })),
    models: models.map((node) => ({ node, graph: node.record.scene.source as never })),
    rankOf,
  });
  for (const [twin, link] of mirror.associations) associations.set(twin, link);
  const first = models[0]?.record;
  const triangles = primitives.reduce(
    (sum, p) => sum + p.pages.reduce((t, page) => t + page.count / 3, 0),
    0,
  );
  const metadata: ClusterManifest = {
    ...(first?.metadata ?? {}),
    schema: first?.metadata.schema ?? CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: first?.metadata.key ?? 'world',
    scope: first?.metadata.scope ?? 'full',
    errorModel: first?.metadata.errorModel ?? 'dag-group-qem-v1',
    clusterStrategy: first?.metadata.clusterStrategy ?? 'dag-groups',
    geometryPages: { formatVersion: GEOMETRY_PAGE_FORMAT_VERSION, codec: GEOMETRY_PAGE_CODEC },
    sourceTriangles: triangles,
    selectedTriangles: triangles,
    selectedNodes: [],
    totalNodes: 0,
    autonomousScene: null,
    primitives,
  };
  const base =
    first?.base ?? (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI);
  const graph = mirror.root as never;
  return {
    root: mirror.root,
    twins: mirror.twins,
    source: {
      manifestUrl: first?.manifestUrl ?? base,
      metadataUrl: first?.metadataUrl ?? base,
      base,
      metadata,
      callerOwned: true,
      scene: {
        source: graph,
        sceneLightingSource: graph,
        associations: associations as never,
        textureIndices: first?.scene.textureIndices ?? new Map(),
        framingLot: null,
      },
    },
  };
}
