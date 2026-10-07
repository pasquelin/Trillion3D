import type { ImpostorMaps, ImpostorSection } from '../../../../sdk-core/src/index.ts'
import { markReach } from '../../deformation/halfFloat.ts'
import type { EngineCamera } from '../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import {
  createImpostorCards,
  dropImpostorCards,
  impostorWorldsMoved,
  planImpostorCards,
  type CardMoved,
} from '../../impostor/cards.ts'
import { createImpostorPass, type ImpostorPass } from './pass.ts'

/** A session's impostor tier on WebGPU: the pass, the baked meshes, and this image's cards. */
export type WebgpuImpostors = ReturnType<typeof createWebgpuImpostors>

function createWebgpuImpostors(
  rt: WebgpuPagesRuntime,
  pass: ImpostorPass,
  section: ImpostorSection,
) {
  // The roots whose card bit moved are handed to the GPU cut (`markWorld`), their reach kept.
  const moved: CardMoved = (rank, root) =>
    rt.run.gpuSelection?.markWorld(rank, markReach(root.mark ?? 0, root.reach ?? 0))
  const cards = createImpostorCards<GPUBindGroup>(section)
  return Object.assign(cards, {
    pass,
    moved,
    /** The roots `ranks` moved — every root when absent —: their switch and cards follow. */
    worldsMoved: (ranks?: ArrayLike<number>) => impostorWorldsMoved(cards, ranks),
    /** A placement's link to the world DAG moved: whether it may take a card is read again. */
    linkMoved: (rank: number) => cards.watch.touch(rank),
    /** The card buffer the records were last written into whole. */
    uploadedTo: undefined as GPUBuffer | undefined,
    /** The group of a mesh's atlas, drawn this image; asked while absent (`feed.ts`). */
    atlasOf: (mesh: number, maps: ImpostorMaps) => pass.feed.group(mesh, maps, rt.run.frame),
  })
}

/** The session's impostor tier, made by the first image that can draw it: a baked section, the
 *  level reader and the visibility buffer's surfaces. A cache without impostors makes nothing. */
function impostorsOf(rt: WebgpuPagesRuntime): WebgpuImpostors | undefined {
  const section = rt.context.metadata.impostors,
    reader = rt.context.readTextureLevel,
    device = rt.gpu.device
  if (rt.gpu.impostors) return rt.gpu.impostors
  if (!section?.baked || !reader || !device) return undefined
  const { setup, vis, diag } = rt
  const pass = createImpostorPass(device, reader, {
    // What the one texture budget leaves beside the pool's floor and the live textures.
    room: () =>
      setup.texturePoolBudget -
      (setup.texturePools?.poolFor(1).allocatedBytes ?? 0) -
      (vis.textures?.sources.liveBytes ?? 0),
    landed: () => rt.run.gate.resourcesChanged(),
    onFailure: diag.diagnosticFailure,
  })
  return (rt.gpu.impostors = createWebgpuImpostors(rt, pass, section))
}

/**
 * THE IMAGE'S IMPOSTOR PLAN on WebGPU: the shared plan (`planImpostorCards`) at the engine's focal
 * length for the image's viewport, each card kept once its mesh's atlas group is made (`feed.ts`),
 * save on a root the packed world DAG stands in for, whose super-roots draw it far away instead.
 * The roots whose card bit moved are handed to the GPU cut too: every camera cut, CPU and GPU,
 * leaves a marked root to its card, every light cut keeps its clusters.
 */
export function planWebgpuImpostors(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const roots = rt.layout.selectionRoots,
    state = impostorsOf(rt)
  // A tier the visibility buffer's drop turned off suppresses nothing and draws nothing.
  if (!state) return dropImpostorCards(rt.gpu.impostors, roots, rt.gpu.impostors?.moved)
  const viewport = rt.setup.viewport ?? rt.gpu.targetSize
  // A root linked to the world DAG is its super-roots' far away (`../../gpu/dag/worldLinks.ts`): it
  // takes no card, which would draw it twice; one the world does not hold — a host mesh, an object
  // outside its table — keeps its card. A link that moves reads the root again (`linkMoved`).
  const selection = rt.run.gpuSelection,
    linked = selection?.worldStandsIn
  if (selection && selection.linkMoved !== state.linkMoved) {
    selection.linkMoved = state.linkMoved
    state.watch.touchAll()
  }
  const carded = linked ? (rank: number) => !linked(rank) : undefined
  planImpostorCards(state, roots, cam, viewport, state.atlasOf, state.moved, carded)
}
