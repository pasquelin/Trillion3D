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
import type { WorldModels } from './worldModels.ts'
import type { WorldRanks } from './worldRanks.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { modelWorldRoots, type LoadedModel } from './loadedModel.ts'
import { absolutePrimitive } from '../../scene/absolutePrimitive.ts'

/** Each primitive with absolute addresses, made once however often a session reopens: a model
 * whose manifest the view holds lists more or fewer of them from one opening to another. */
const absolute = new WeakMap<Primitive, Primitive>()
function absolutePrimitives(model: LoadedModel) {
  const { metadata, base } = model.record
  return metadata.primitives.map((primitive) => {
    let made = absolute.get(primitive)
    if (!made) absolute.set(primitive, (made = absolutePrimitive(primitive, base)))
    return made
  })
}

/** What a session is opened on: the batches placed by rows, and the models. */
export type WorldPlan = {
  batches: readonly Batch[]
  models: readonly LoadedModel[]
  /** The ranks the world gave its resources and models (`worldRanks.ts`). */
  ranks: WorldRanks
  /** What each model draws (`worldModels.ts`). */
  worldModels: WorldModels
}

/**
 * The scene a world's session opens on: one manifest merging the loaded models' (their page
 * addresses made absolute, their mesh ranks moved past each other's) and one primitive per
 * geometry resource, and the sources that are drawn by it — the batches, then each model's
 * meshes: no node stands for any of them. One model lends the session its base — its baked
 * texture levels, its resident proxy, its declared lights: the one whose images were left to the
 * cache, which only that base serves; else the first. Null when nothing is drawn.
 */
export function buildWorldSource(plan: WorldPlan) {
  const { batches, models, ranks, worldModels } = plan
  const drawn = models.map((model) => worldModels.drawsOf(model))
  const placed = drawn.flatMap(({ draws }) => draws)
  const primitives: Primitive[] = models.flatMap((model, i) =>
    absolutePrimitives(model).map((primitive) => ({
      ...primitive,
      mesh: primitive.mesh + drawn[i].offset,
    })),
  )
  // One primitive per geometry resource, however many batches wear it and rows place it.
  const ranked = new Set<Cut>()
  for (const { cut } of batches)
    if (!ranked.has(cut)) {
      ranked.add(cut)
      primitives.push({ ...cut.runtime.primitive, mesh: ranks.cut(cut) })
    }
  if (!primitives.length && !placed.length && !batches.length) return null
  const { first, metadata, base } = worldManifest(models, primitives)
  // The root of the nodes the session reads: it holds none, no light and no bound.
  const root = new Group()
  return {
    root,
    source: {
      manifestUrl: first?.manifestUrl ?? base,
      metadataUrl: first?.metadataUrl ?? base,
      base,
      metadata,
      scene: {
        source: root,
        sceneLightingSource: root,
        draws: [...batches, ...placed],
        textureIndices: first?.scene.textureIndices ?? new Map(),
        ...{ framingLot: null, nodes: null },
        // A world plays its models' clips through their own mixers, never through its session.
        clips: [],
        // Each model's cells follow the session's camera.
        partitions: models.flatMap((model) => model.record.scene.partitions),
        worldRoots: models.flatMap(modelWorldRoots),
      },
    },
  }
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
