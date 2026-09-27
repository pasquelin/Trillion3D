import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type Primitive,
} from '../../../../sdk-core/src/index.ts';
import type { Cut } from './worldCuts.ts';
import type { Batch } from './worldBatches.ts';
import { buildWorldMirror } from './worldMirror.ts';
import type { LoadedModel } from './loadedModel.ts';
import type { ExplorerScene } from '../session/prepare.ts';
import type { PlacementMount } from '../../placement/backendSceneUpdates.ts';

/** A page's addresses made absolute against the manifest they were read from. */
function absolutePrimitive(primitive: Primitive, base: string): Primitive {
  const at = (url: string) => new URL(url, base).href;
  return {
    ...primitive,
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

/** Each model's primitives with absolute addresses, made once however often a session reopens. */
const absolute = new WeakMap<LoadedModel, Primitive[]>();
function absolutePrimitives(model: LoadedModel) {
  let primitives = absolute.get(model);
  if (!primitives) {
    const { metadata, base } = model.record;
    primitives = metadata.primitives.map((primitive) => absolutePrimitive(primitive, base));
    absolute.set(model, primitives);
  }
  return primitives;
}

/** A loaded model's source graph as the mirror nests it: the host scene its loader built. */
const modelGraph = (model: LoadedModel) =>
  model.record.scene.source as unknown as Parameters<
    typeof buildWorldMirror
  >[0]['models'][number]['graph'];

/** What a session is opened on: the batches placed by rows, and the models. */
export type WorldPlan = {
  batches: readonly Batch[];
  models: readonly LoadedModel[];
};

/**
 * The scene a world's session opens on: one manifest merging the loaded models' (their page
 * addresses made absolute, their mesh ranks moved past each other's) and one primitive per
 * geometry resource, and the host graph that places them (`buildWorldMirror`). One model lends
 * the session its base — its baked texture levels, its resident proxy, its declared lights: the
 * one whose images were left to the cache, which only that base serves; else the first. Null
 * when nothing is drawn.
 */
export function buildWorldSource(plan: WorldPlan) {
  const { batches, models } = plan;
  const primitives: Primitive[] = [];
  const associations: ExplorerScene['associations'] = new Map();
  let offset = 0;
  for (const model of models) {
    const { metadata, scene: graph } = model.record;
    for (const primitive of absolutePrimitives(model))
      primitives.push({ ...primitive, mesh: primitive.mesh + offset });
    for (const [node, link] of graph.associations) {
      const moved = { ...link, meshes: (link.meshes ?? 0) + offset };
      // Rows a partition's cells place are sized on the model's own link: the session reads them there.
      if (link.placements)
        Object.defineProperty(moved, 'placements', {
          get: () => link.placements,
          enumerable: true,
        });
      associations.set(node, moved);
    }
    offset += Math.max(-1, ...metadata.primitives.map((p) => p.mesh)) + 1;
  }
  // One primitive per geometry resource, however many batches wear it and rows place it.
  const ranked = new Map<Cut, Primitive>();
  const rankOf = (cut: Cut) => {
    let primitive = ranked.get(cut);
    if (!primitive) {
      ranked.set(cut, (primitive = { ...cut.runtime.primitive, mesh: offset++ }));
      primitives.push(primitive);
    }
    return primitive.mesh;
  };
  if (!primitives.length && !batches.length) return null;
  const placedOf = (batch: Batch) => ({
    cut: batch.cut,
    material: batch.entry.material,
    rows: batch.rows!,
    name: batch.entry.material.name as string,
  });
  const mirror = buildWorldMirror({
    placed: batches.map(placedOf),
    models: models.map((node) => ({ node, graph: modelGraph(node) })),
    rankOf,
  });
  const nodes = new Map(batches.map((batch, i) => [batch, mirror.placed[i].node]));
  for (const [twin, link] of mirror.associations) associations.set(twin, link);
  const first = (models.find((model) => model.record.textureSource === 'cache') ?? models[0])
    ?.record;
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
    errorModel: first?.metadata.errorModel ?? DAG_ERROR_MODEL,
    clusterStrategy: first?.metadata.clusterStrategy ?? 'dag-groups',
    geometryPages: { formatVersion: GEOMETRY_PAGE_FORMAT_VERSION, codec: GEOMETRY_PAGE_CODEC },
    sourceTriangles: triangles,
    selectedTriangles: triangles,
    selectedNodes: 0,
    totalNodes: 0,
    autonomousScene: null,
    primitives,
  };
  const base =
    first?.base ?? (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI);
  const graph = mirror.root;
  return {
    root: mirror.root,
    twins: mirror.twins,
    repaint: mirror.repaint,
    /** A batch the session was not opened with, as it mounts it (`PlacementMount`): its host
     *  mesh hung in the graph, its primitive listed in the manifest. */
    mount(batch: Batch): PlacementMount {
      const { node, association } = mirror.place(placedOf(batch));
      nodes.set(batch, node);
      return { node, association, primitive: ranked.get(batch.cut)! };
    },
    /** A batch the session no longer draws: its host mesh, and its resource's primitive and
     *  geometry once no other batch wears it. True when the resource left. */
    unmount(batch: Batch) {
      const node = nodes.get(batch)!;
      nodes.delete(batch);
      const worn = [...nodes.keys()].some((other) => other.cut === batch.cut);
      mirror.unplace(node, worn ? undefined : batch.cut);
      if (worn) return false;
      primitives.splice(primitives.indexOf(ranked.get(batch.cut)!), 1);
      return ranked.delete(batch.cut);
    },
    source: {
      manifestUrl: first?.manifestUrl ?? base,
      metadataUrl: first?.metadataUrl ?? base,
      base,
      metadata,
      scene: {
        source: graph,
        sceneLightingSource: graph,
        associations,
        textureIndices: first?.scene.textureIndices ?? new Map(),
        framingLot: null,
        // Each model's cells follow the session's camera; their rows hang under the model's twin.
        partitions: models.flatMap((model) => model.record.scene.partitions),
      },
    },
  };
}
