import { meshes as objects } from '../../scene/meshes.ts'
import { assertFiniteTransform } from '../../host/world/matrices.ts'
import { replicateInstances } from '../../scene/replicateInstances.ts'
import { hostBoundsLot, hostWorldBounds } from '../../host/world/bounds.ts'
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts'
import { createMultiplyLot } from '../../page/decode/batch/batchRuntime.ts'
import { mathBatchModule } from '../../page/decode/batch/batchState.ts'
import type { MeasuredWorldOptions } from '../../engine/types.ts'
import type { ExplorerEmitters } from '../session/session.ts'
import { resourceProgress } from './resourceProgress.ts'
import { openWorldRoots } from '../../scene/worldRoots.ts'
import type { PageQueue } from '../../streaming/types.ts'
import { loadPreparedSceneTables } from '../../scene/tables.ts'
import { buildPreparedScene } from '../../host/prepared/build.ts'
import { createPartitionCells } from '../../partition/cells.ts'
import type { ByteMeter } from '../../cluster/byteMeter.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { hostWorldPlacements } from '../../host/world/placements.ts'
import { graphDraws } from '../../page/selection/drawSource.ts'

/** What a load that counts bytes adds: the meter of each read, and who hears the tables read. */
type Metered = {
  meter?: ByteMeter
  onTables?: (tables: PreparedSceneTables) => void
  /** The queue the scene's world roots are read through, bound to it: the session's it loads for,
   *  or — a world's model, before any session — one of its own over its world's page cache. */
  queue: PageQueue
}

/** What one prepared scene's load reads and reports through. */
type SceneLoad = {
  options: MeasuredWorldOptions & Metered
  metadata: ClusterManifest
  base: string
  scope: string
  signal: AbortSignal | undefined
  diagnose: ExplorerEmitters['diagnose']
}

/** The scene tables, heard as soon as read (`onTables`, `onPreparation`), and when the read began
 *  and ended. */
async function readTables({ options, base, signal }: SceneLoad) {
  const readAt = performance.now()
  const { tables, bytes } = await loadPreparedSceneTables(base, signal, options.meter)
  const buildAt = performance.now()
  signal?.throwIfAborted()
  options.onTables?.(tables)
  options.onPreparation?.({
    phase: 'tables',
    completed: 1,
    total: 1,
    message: 'Read the scene tables',
  })
  return { tables, bytes, readAt, buildAt }
}

/** The scene the tables build and the world roots it opens, the top pinned when no partition
 *  places it. Images whose chain is baked are not read under `textureSource: 'cache'`: a white
 *  pixel stands in their place, and the engine reads their levels from the cache. */
async function buildScene(load: SceneLoad, tables: PreparedSceneTables) {
  const { options, metadata, base, scope, signal, diagnose } = load
  const skipBaked = options.textureSource !== 'host'
  const [built, worldRoots] = await Promise.all([
    buildPreparedScene({
      tables,
      metadata,
      base,
      skipBaked,
      signal,
      track: resourceProgress(options, diagnose, scope, signal),
      meter: options.meter,
    }),
    openWorldRoots(metadata, base, options.queue, { signal, whole: !tables.partition }),
  ])
  if (skipBaked && metadata.textures)
    diagnose('preparation', `Images read from the cache: ${built.bakedImages}`, {
      kind: 'preparation',
      phase: 'resources',
      bakedImages: built.bakedImages,
      scope,
    })
  return { built, worldRoots }
}

type Built = Awaited<ReturnType<typeof buildScene>>

/** The cells a partition reads by distance; they place rows replicas would share, so a
 *  partitioned scene is not replicated. */
function partitionsOf(
  tables: PreparedSceneTables,
  { built, worldRoots }: Built,
  base: string,
  replicas: number,
) {
  if (tables.partition && replicas > 1)
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'a partitioned scene is not replicated', {
      replicas,
    })
  return tables.partition
    ? [
        createPartitionCells({
          partition: tables.partition,
          base,
          root: built.source,
          parents: built.nodes,
          meshes: built.placed,
          world: worldRoots,
        }),
      ]
    : []
}

/** Says the scene built: its counts, the bytes of its tables and how long reading and building
 *  took. */
function reportPrepared(
  { diagnose, scope }: SceneLoad,
  read: Awaited<ReturnType<typeof readTables>>,
  textures: number,
) {
  const { tables, bytes, readAt, buildAt } = read
  diagnose('prepared-scene', 'Scene built from the cache tables', {
    kind: 'preparation',
    scope,
    nodes: tables.nodes.length,
    placements: [...(tables.partition?.totals.values() ?? [])].reduce((sum, n) => sum + n, 0),
    materials: tables.materials.length,
    textures,
    bytes,
    readMs: buildAt - readAt,
    buildMs: performance.now() - buildAt,
  })
}

/** No non-finite pose enters the engine: each mesh world matrix is read from the transform tree
 *  after one frame pass. Without this refusal, a host NaN would come out as a darkened surface at
 *  the bottom of the lighting shader, far from its cause. */
function assertFinitePoses(source: Object3D) {
  const worlds = hostWorldPlacements(source)
  for (const mesh of objects(source)) assertFiniteTransform(worlds.of(mesh).elements, mesh.name)
}

/** `source` copied `replicas` times (`replicateInstances`). Load buffers, reserved before they are
 *  written and returned as soon as they are read: the host boxes of the scene, only when
 *  replication asks for them, then replica matrices. Reserve by lot, never per frame. */
async function replicated(
  source: Object3D,
  associations: Built['built']['associations'],
  replicas: NonNullable<MeasuredWorldOptions['replicaCount']>,
) {
  const boundsLot = replicas > 1 ? await hostBoundsLot(source) : null
  const preparedBounds = replicas > 1 ? hostWorldBounds(source, undefined, boundsLot) : undefined
  const instances = replicas > 1 ? await createMultiplyLot(replicas * objects(source).length) : null
  const copied = replicateInstances(source, associations, replicas, preparedBounds, instances)
  instances?.release()
  boundsLot?.release()
  return copied
}

/** Builds the scene a cache prepared: its tables, then the files they name. `options.meter` counts
 *  the bytes of each as they arrive, `onTables` hears the tables before those files are read;
 *  `onPreparation` hears the tables read, then each resource. */
export async function loadPreparedScene(
  options: MeasuredWorldOptions & Metered,
  metadata: ClusterManifest,
  base: string,
  scope: string,
  signal: AbortSignal | undefined,
  diagnose: ExplorerEmitters['diagnose'],
  registerSource: (source: Object3D) => void,
) {
  const load: SceneLoad = { options, metadata, base, scope, signal, diagnose }
  // The module the load's lots run in starts loading here and overlaps with the scene's, which
  // lasts much longer; a refusal is told where the lots wait for it, below.
  const mathBatch = mathBatchModule()
  mathBatch.catch(() => {})
  // The scene is built from the cache alone: its tables, the binary of the document it draws and
  // the images they locate. `textureSource` reads `'host'` for a model after a world's first
  // (`worldLoader.ts`), or where the platform cannot read the baked levels
  // (`resolveTextureSource`).
  const read = await readTables(load)
  const { tables } = read
  const scene = await buildScene(load, tables)
  const { built, worldRoots } = scene
  const { associations, textureIndices } = built
  const replicas = options.replicaCount ?? 1
  const partitions = partitionsOf(tables, scene, base, replicas)
  reportPrepared(load, read, textureIndices.size)
  registerSource(built.source)
  assertFinitePoses(built.source)
  const sceneLightingSource = options.sceneLighting ?? built.source
  signal?.throwIfAborted()
  await mathBatch
  const source = await replicated(built.source, associations, replicas)
  // Camera framing takes these same bounds on the FINAL scene: its buffer is reserved here,
  // at the size it has once replicated, and returned by the caller.
  const framingLot = await hostBoundsLot(source)
  return {
    /** The root of the scene's nodes, replicated as the options ask. */
    source,
    /** The node whose lights and environment the scene is lit by: `options.sceneLighting`, else the
     *  scene's own root before any replication. */
    sceneLightingSource,
    /** The meshes and primitives each node of the scene stands for, by node. */
    associations,
    /** What the scene draws, one source for each drawn node in the graph's order. */
    draws: graphDraws(source, associations),
    /** The rank of each texture of the scene in the table the shaders index. */
    textureIndices,
    /** The lot the camera framing takes the scene's bounds in, `null` when no node is bounded;
     *  the caller returns it. */
    framingLot,
    /** The cells a partitioned scene is read by, none when the scene is not partitioned. */
    partitions,
    /** The clips the file plays (#357). */
    clips: built.clips,
    /** The world roots the scene holds, bound to each session's queue and counted in its CPU
     *  budget. */
    worldRoots: worldRoots ? [worldRoots] : [],
    /** Each glTF node's host node, by its index; none when the scene is partitioned or replicated: a
     *  partition renumbers the table, replicas copy it. */
    nodes: tables.partition || replicas > 1 ? null : built.nodes,
  }
}
