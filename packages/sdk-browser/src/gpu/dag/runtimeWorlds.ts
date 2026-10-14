// What a camera cut's worlds take on the host (`runtime.ts`): the placements a send moved, compared
// with the worlds last received and sent, each run to its records, and an unlinked placement's pose
// written again.
import { changedWorlds, worldChangedAt } from './worlds.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { DagRun } from './runtimeOps.ts'

/** `GpuSelection.updateWorlds`: the placements sent, compared with the last ones — every one, or
 *  those of `named` alone (`updateNamedWorlds`) —; those whose pose moved. */
export function updateRuntimeWorlds(run: DagRun, next: Float32Array, named?: Int32Array) {
  const { resources, state } = run,
    { packed, frames } = resources
  if (state.disposed || state.dead) return NO_RANKS
  if (next.byteLength !== packed.worlds.byteLength) throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED')
  if (named) return updateNamedWorlds(run, next, named)
  const origins = frames.writeWorldOrigins()
  run.proxies.worldsWritten(origins)
  // `packed.worlds` is what this selection last received, and only this method writes it:
  // the worlds the next send is compared with, without a second copy of them beside it. The rows
  // whose read words moved go up, they alone: a translation goes up through the origins.
  // The live placements alone, the room a growth keeps left out.
  const live = packed.worldSources.length
  movedScratch = resized(movedScratch, live)
  const moved = changedWorlds(packed.worlds, next, movedScratch, live)
  return posesMoved(run, sendMoved(run, next, moved), origins)
}

/** No placement moved. */
const NO_RANKS = new Int32Array(0)

/** The placements whose pose moved: the `moved` first of `movedScratch` — their read words — and
 *  `origins` — their exact translation —, each increasing, joined in one pass into the run's list,
 *  each once. One moved: the cuts in hand and in flight keep their revision and still name what
 *  to stream. */
function posesMoved(run: DagRun, moved: number, origins: Int32Array) {
  const n = origins.length
  if (!moved && !n) return NO_RANKS
  const into = (run.moves = resized(run.moves, moved + n))
  let i = 0,
    j = 0,
    count = 0
  while (i < moved || j < n) {
    const a = i < moved ? movedScratch[i] : Infinity,
      b = j < n ? origins[j] : Infinity
    into[count++] = Math.min(a, b)
    if (a <= b) i++
    if (b <= a) j++
  }
  run.state.worldRevision++
  const ranks = into.subarray(0, count)
  // The tree follows the poses the send moved, a host walk's as a call's.
  run.tree?.moved(ranks)
  return ranks
}

/** The placements that moved among those of `named`, and the one an unlink writes again. */
let movedScratch = new Int32Array(8)
const rewritten = new Int32Array(1)

/**
 * The placements of `named`, increasing — the ones a call moved —, compared with the worlds last
 * received and those that moved sent, each run to its records, with their exact translations; their
 * stretch is the GPU's, from the world it holds (`../../placement/rootBoxes.ts`): a frame's CPU and
 * upload follow what moved, never the placements' count. Each cut reads a translation at its own eye from the exact one
 * (`shader/worldPoseWgsl.ts`): a translation that alone moved writes its doubles alone. The ranks
 * the packing holds are kept once, here: every step below reads them alone.
 */
function updateNamedWorlds(run: DagRun, next: Float32Array, all: Int32Array) {
  const { packed, frames } = run.resources
  let held = all.length
  while (held && all[held - 1] >= packed.worldSources.length) held--
  const named = held === all.length ? all : all.subarray(0, held)
  const origins = frames.writeWorldOrigins(named)
  // A translation alone is no cut's matrix word: the proxy mirrors it from the origins.
  run.proxies.worldsWritten(origins)
  movedScratch = resized(movedScratch, named.length)
  let moved = 0
  for (const w of named) if (worldChangedAt(packed.worlds, next, w)) movedScratch[moved++] = w
  return posesMoved(run, sendMoved(run, next, moved), origins)
}

/** The `moved` first placements of `movedScratch`, whose read words moved: their worlds copied
 *  into those held and sent, each run to its records; their count. */
function sendMoved(run: DagRun, next: Float32Array, moved: number) {
  const { packed, frames } = run.resources
  for (let i = 0; i < moved; i++) {
    const w = movedScratch[i]
    packed.worlds.set(next.subarray(w * 16, w * 16 + 16), w * 16)
  }
  if (moved) {
    frames.writeNamedWorlds(packed.worlds, movedScratch, moved)
    run.proxies.worldsWritten(movedScratch, moved)
  }
  return moved
}

/** `GpuSelection.composedPlacement`, unlinked: placement `w`'s parent no longer poses it, and the
 *  pose it composed on the GPU — words the host never wrote — is replaced by the host's own, its
 *  world and its exact translation written again whatever the caches held. Its stretch is the root
 *  boxes pass's, from the host's world the unlink sends (`../../placement/gpuComposeLinks.ts`
 *  `unlinkHeld`, `noteRootWorld`): no frame row goes up. */
export function rewritePlacement({ resources, state, proxies }: DagRun, w: number) {
  const { packed, frames } = resources
  if (w >= packed.worldSources.length) return
  frames.forgetOrigin(w)
  rewritten[0] = w
  frames.writeWorldOrigins(rewritten)
  frames.writeNamedWorlds(packed.worlds, rewritten, 1)
  proxies.worldsWritten(rewritten, 1)
  state.worldRevision++
}
