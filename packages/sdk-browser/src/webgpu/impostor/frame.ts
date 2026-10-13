import type { ImpostorSection } from '../../../../sdk-core/src/index.ts'
import { markReach } from '../../deformation/halfFloat.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import {
  createImpostorCards,
  dropImpostorCards,
  impostorWorldsMoved,
  planImpostorCards,
} from '../../impostor/cards.ts'
import { createImpostorPass, type ImpostorPass } from './pass.ts'

/** A session's impostor tier on WebGPU: the pass, the baked meshes, and this image's cards. */
export type WebgpuImpostors = ReturnType<typeof createWebgpuImpostors>

function createWebgpuImpostors(
  rt: WebgpuPagesRuntime,
  pass: ImpostorPass,
  section: ImpostorSection,
) {
  const cards = createImpostorCards(section, {
    // A mesh's maps in the one tile pool, ready once every tile its cards read resides, the
    // missing ones asked (`../tile/cardTiles.ts`).
    tilesOf: (mesh) => rt.vis.textures?.cards.tilesOf(mesh),
    ready: (tiles, ask) => rt.vis.textures?.cards.ready(tiles, ask) ?? false,
    // The roots whose card bit moved are handed to the GPU cut (`markWorld`), their reach kept.
    moved: (rank, root) =>
      rt.run.gpuSelection?.markWorld(rank, markReach(root.mark ?? 0, root.reach ?? 0)),
    // A root linked to the world DAG is its super-roots' far away (`../../gpu/dag/worldLinks.ts`):
    // it takes no card, which would draw it twice; one the world does not hold — a host mesh, an
    // object outside its table — keeps its card, as the session's cut says now.
    carded: (rank) => !rt.run.gpuSelection?.worldStandsIn(rank),
  })
  return Object.assign(cards, {
    pass,
    /** The roots `ranks` moved: their switch and cards follow. */
    worldsMoved: (ranks: ArrayLike<number>) => impostorWorldsMoved(cards, ranks),
    /** A placement's link to the world DAG moved: whether it may take a card is read again (the
     *  session's cut tells it, `../pages/prepare/cut.ts`). */
    linkMoved: (rank: number) => cards.watch.touch(rank),
    /** The card buffer the records were last written into whole. */
    uploadedTo: undefined as GPUBuffer | undefined,
  })
}

/** The session's impostor tier, made by the first image that can draw it: a baked section whose
 *  maps the tile catalogue holds (`../tile/cardMaps.ts`). A cache without impostors makes
 *  nothing. */
function impostorsOf(rt: WebgpuPagesRuntime): WebgpuImpostors | undefined {
  const section = rt.context.metadata.impostors,
    device = rt.gpu.device
  if (rt.gpu.impostors) return rt.gpu.impostors
  if (!section?.baked || !rt.vis.textures?.cards.count || !device) return undefined
  return (rt.gpu.impostors = createWebgpuImpostors(rt, createImpostorPass(device), section))
}

/**
 * THE IMAGE'S IMPOSTOR PLAN on WebGPU: the shared plan (`planImpostorCards`) at the engine's focal
 * length for the image's viewport, each card kept once its mesh's maps hold what it reads,
 * save on a root the packed world DAG stands in for, whose super-roots draw it far away instead.
 * The roots whose card bit moved are handed to the GPU cut too: every camera cut, CPU and GPU,
 * leaves a marked root to its card, every light cut keeps its clusters.
 */
export function planWebgpuImpostors(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const roots = rt.layout.selectionRoots,
    state = impostorsOf(rt)
  // A tier the visibility buffer's drop turned off suppresses nothing and draws nothing.
  if (!state) return dropImpostorCards(rt.gpu.impostors)
  const viewport = rt.setup.viewport ?? rt.gpu.targetSize
  planImpostorCards(state, roots, cam, viewport)
}
