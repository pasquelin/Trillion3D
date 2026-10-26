import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  DAG_ERROR_MODEL,
} from '../../../../sdk-core/src/contracts/base.ts'
import { GEOMETRY_PAGE_CODEC } from '../../../../sdk-core/src/manifest/binaryFormat.ts'
import { GEOMETRY_PAGE_FORMAT_VERSION } from '../../../../sdk-core/src/page/format.ts'
import type { ClusterManifest, Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { Cut } from './cuts.ts'
import type { Batch } from './batches.ts'
import type { ModelDraws, WorldModels } from './models/models.ts'
import type { WorldRanks } from './ranks.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { modelPartitions, type LoadedModel, type ModelRecord } from './models/loadedModel.ts'

/** What a session is opened on: the batches placed by rows, and the models. */
export type WorldPlan = {
  batches: readonly Batch[]
  models: readonly LoadedModel[]
  /** The ranks the world gave its resources and models (`ranks.ts`). */
  ranks: WorldRanks
  /** What each model draws (`models/models.ts`). */
  worldModels: WorldModels
}

/**
 * The scene a world's session opens on: one manifest merging the loaded models' (their page
 * addresses made absolute, their mesh ranks moved past each other's) and one primitive per
 * geometry resource, and the sources that are drawn by it — the batches, then each model's
 * meshes: no node stands for any of them. Each model's textures read the levels its own cache
 * baked. The first model lends the
 * session its base — its declared lights. Null when nothing is drawn.
 */
export function buildWorldSource(plan: WorldPlan) {
  const { batches, models, ranks, worldModels } = plan
  // A model placed again is one record: its sources, primitives and world roots enter once, each
  // placement a row of them (`WorldModels.place`); its partitions' placements each follow the view.
  const records = new Map<ModelRecord, ModelDraws>()
  for (const model of models) records.set(model.record, worldModels.drawsOf(model))
  const drawn = [...records.values()]
  const placed = drawn.flatMap(({ draws }) => draws)
  const primitives: Primitive[] = drawn.flatMap(({ primitives }) => primitives)
  // One primitive per geometry resource, however many batches wear it and rows place it.
  const ranked = new Set<Cut>()
  for (const { cut } of batches)
    if (!ranked.has(cut)) {
      ranked.add(cut)
      primitives.push(ranks.primitive(cut))
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
        draws: [...batches, ...placed],
        // Each record's textures from its own cache: its chains, read from its folder.
        textureCaches: models.flatMap((model) => model.record.scene.textureCaches),
        ...{ framingLot: null, nodes: null, streams: new Set<number>() },
        // A world plays its models' clips through their own mixers, never through its session; and
        // their banks' tracks by their own clocks, which the models own (`loadedModel.ts`).
        clips: [],
        banks: null,
        // Each model's cells follow the session's camera.
        partitions: models.flatMap((model) => modelPartitions(model)),
        // Each record's world roots once, whatever its placements: each one an instance of them.
        worldRoots: [...new Set(models.flatMap((model) => worldModels.rootsOf(model)))],
      },
    },
  }
}

/** The one manifest a world's session reads, lent its base by the first model; and the address its
 *  pages resolve against. */
function worldManifest(models: readonly LoadedModel[], primitives: Primitive[]) {
  const first = models[0]?.record
  const triangles = primitives.reduce(
    (sum, p) => sum + p.pages.reduce((t, page) => t + page.count / 3, 0),
    0,
  )
  const metadata: ClusterManifest = {
    ...(first?.metadata ?? {}),
    formatVersion: first?.metadata.formatVersion ?? CLUSTERED_BLEND_FORMAT_VERSION,
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
