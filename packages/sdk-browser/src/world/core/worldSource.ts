import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type Primitive,
} from '../../../../sdk-core/src/index.ts'
import type { Cut } from './worldCuts.ts'
import type { Batch } from './worldBatches.ts'
import { buildWorldMirror } from './worldMirror.ts'
import type { LoadedModel } from './loadedModel.ts'
import type { ExplorerScene } from '../session/prepare.ts'
import { absolutePrimitive } from '../../scene/absolutePrimitive.ts'

/** Each primitive with absolute addresses, made once however often a session reopens: a model
 *  whose manifest the view holds (#751) lists more or fewer of them from one opening to another. */
const absolute = new WeakMap<Primitive, Primitive>()
function absolutePrimitives(model: LoadedModel) {
  const { metadata, base } = model.record
  return metadata.primitives.map((primitive) => {
    let made = absolute.get(primitive)
    if (!made) absolute.set(primitive, (made = absolutePrimitive(primitive, base)))
    return made
  })
}

/** A loaded model's source graph as the mirror nests it: the host scene its loader built. */
const modelGraph = (model: LoadedModel) =>
  model.record.scene.source as unknown as Parameters<
    typeof buildWorldMirror
  >[0]['models'][number]['graph']

/** What a session is opened on: the batches placed by rows, and the models. */
export type WorldPlan = {
  batches: readonly Batch[]
  models: readonly LoadedModel[]
}

/**
 * The scene a world's session opens on: one manifest merging the loaded models' (their page
 * addresses made absolute, their mesh ranks moved past each other's) and one primitive per
 * geometry resource, and the host graph that places them (`buildWorldMirror`). One model lends
 * the session its base — its baked texture levels, its resident proxy, its declared lights: the
 * one whose images were left to the cache, which only that base serves; else the first. Null
 * when nothing is drawn.
 */
export function buildWorldSource(plan: WorldPlan) {
  const { batches, models } = plan
  const merged = mergeModels(models)
  const { primitives, associations } = merged
  // One primitive per geometry resource, however many batches wear it and rows place it.
  const ranked = new Map<Cut, Primitive>()
  const rankOf = (cut: Cut) => {
    let primitive = ranked.get(cut)
    if (!primitive) {
      ranked.set(cut, (primitive = { ...cut.runtime.primitive, mesh: merged.offset++ }))
      primitives.push(primitive)
    }
    return primitive.mesh
  }
  if (!primitives.length && !associations.size && !batches.length) return null
  const placedOf = (batch: Batch) => ({
    cut: batch.cut,
    material: batch.entry.material,
    rows: batch.rows!,
    name: batch.entry.material.name as string,
    twoSided: batch.twoSided,
  })
  const mirror = buildWorldMirror({
    placed: batches.map(placedOf),
    models: models.map((node) => ({ node, graph: modelGraph(node) })),
    rankOf,
  })
  for (const [twin, link] of mirror.associations) associations.set(twin, link)
  const { first, metadata, base } = worldManifest(models, primitives)
  const graph = mirror.root
  return {
    root: mirror.root,
    twins: mirror.twins,
    repaint: mirror.repaint,
    geometryOf: mirror.geometryOf,
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
        nodes: null,
        // A world plays its models' clips through their own mixers, never through its session.
        clips: [],
        // Each model's cells follow the session's camera; their rows hang under the model's twin.
        partitions: models.flatMap((model) => model.record.scene.partitions),
        worldRoots: models.flatMap((model) => model.record.scene.worldRoots),
      },
    },
  }
}

/** The loaded models' primitives and associations merged, their mesh ranks moved past each
 *  other's; `offset` the first rank none of them takes. */
function mergeModels(models: readonly LoadedModel[]) {
  const primitives: Primitive[] = []
  const associations: ExplorerScene['associations'] = new Map()
  let offset = 0
  for (const model of models) {
    const { metadata, scene: graph } = model.record
    for (const primitive of absolutePrimitives(model))
      primitives.push({ ...primitive, mesh: primitive.mesh + offset })
    for (const [node, link] of graph.associations) {
      const moved = { ...link, meshes: (link.meshes ?? 0) + offset }
      // Rows a partition's cells place are sized on the model's own link: the session reads them there.
      if (link.placements)
        Object.defineProperty(moved, 'placements', {
          get: () => link.placements,
          enumerable: true,
        })
      associations.set(node, moved)
    }
    // Past every rank its primitives and its meshes name: a mesh whose primitive the view has not
    // read yet (#751) keeps its rank from the next model's.
    let last = -1
    for (const { mesh } of metadata.primitives) last = Math.max(last, mesh)
    for (const link of graph.associations.values()) last = Math.max(last, link.meshes ?? -1)
    offset += last + 1
  }
  return { primitives, associations, offset }
}

/** The one manifest a world's session reads, lent its base by the model whose images were left
 *  to the cache, else the first; and the address its pages resolve against. */
function worldManifest(models: readonly LoadedModel[], primitives: Primitive[]) {
  const first = (models.find((model) => model.record.textureSource === 'cache') ?? models[0])
    ?.record
  const triangles = primitives.reduce(
    (sum, p) => sum + p.pages.reduce((t, page) => t + page.count / 3, 0),
    0,
  )
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
    primitives,
  }
  const base =
    first?.base ?? (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI)
  return { first, metadata, base }
}
