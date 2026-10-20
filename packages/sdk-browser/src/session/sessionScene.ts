import type { ExplorerSession } from './session.ts'
import type { HostCamera } from '../camera/world.ts'
import type { PageQueue } from '../geometry/streaming/types.ts'
import type { PartitionCells } from '../geometry/partition/cells.ts'
import { openingKeeps, sceneThrough, type ExplorerPageSources } from './pageSources.ts'
import { releaseOwned } from './lifecycle.ts'
import { loadPreparedScene } from '../scene/drive/scene.ts'
import { primePartitions } from '../scene/drive/partitionFrame.ts'
import type { Inputs } from './prepare.ts'

/** The scene the session draws: the one handed in, or the one the cache prepared, read through
 *  `streamer`, the session's queue (`sceneThrough`), its world tops said. */
export async function sessionScene(
  session: ExplorerSession,
  inputs: Inputs,
  streamer: PageQueue,
  opening: AbortSignal,
) {
  const { options, metadata, scope, diagnose } = session
  const { base, resources, progress } = inputs
  const keep = openingKeeps(resources, opening, (source) => releaseOwned(session, { source }))
  progress(
    'scene',
    0,
    1,
    `Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`,
  )
  const loadedScene = await sceneThrough(streamer, inputs.scene, () =>
    loadPreparedScene(
      { ...options, queue: streamer },
      metadata,
      base,
      scope,
      opening,
      diagnose,
      keep,
    ),
  )
  keep(loadedScene.source)
  opening.throwIfAborted()
  return loadedScene
}

/** The pages and cells the first camera reaches, placed before the engine reads their rows: the
 *  first frame draws them (`partitionFrame.ts`, #575). That camera is the page's when it hands one
 *  in (a world), else the framing one, which sees the whole scene. */
export async function primeFirstView(
  session: ExplorerSession,
  scene: { partitions: readonly PartitionCells[] },
  camera: HostCamera,
  streamer: ExplorerPageSources['streamer'],
) {
  const { options, scope, signal, diagnose } = session
  if (!scene.partitions.length) return
  const bytes = await primePartitions(
    scene.partitions,
    camera,
    streamer,
    !!options.onPartitionOutgrown,
    signal,
  )
  diagnose('partition', 'Pages and cells read before the first frame', {
    kind: 'preparation',
    scope,
    bytes,
    cells: scene.partitions.map((cells) => cells.stats()),
  })
}
