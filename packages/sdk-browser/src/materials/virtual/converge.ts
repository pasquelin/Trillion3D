import { renderWebgpuPages } from '../../frame/render/render.ts'
import {
  SHADOWS_PENDING,
  TEXTURES_PENDING,
  unsettledMask,
  unsettledReasons,
} from '../../frame/loop/unsettled.ts'
import { taaPhaseCount } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { followTexturePressure } from '../../frame/io/memory.ts'
import { shadowsUnsettled } from '../../frame/backend/state/lights.ts'
import { convergeBound, texturesConverged, drainsAgain } from './convergeRules.ts'
/** Images a barrier grants at most to the shadow pages' round trips: a report read, casters
 *  loaded, pages staled by their arrival. A still camera takes a few; a moving camera voids pages
 *  every image and never converges: the bound is there for it. */
const SHADOW_DRAIN_LIMIT = 64
/** Texture → shadow round-trips at most: each turn that redraws a sun page can move what the shadow
 *  asks of textures, and each arrived tile voids the shadows. */
const POSE_ROUNDS = 4

/**
 * Converges the textures of a pose: the image is rendered with all its pixels on feedback, every
 * other row naming the first of its picks whose tile is missing (`everyPick`), the others the tile
 * they read, stamped so that the pool keeps it (`feedbackMissing`); what they ask is served with
 * no budget, and we start over until no requested tile is missing. At a capture's barrier
 * (`pictured`) each image draws the next jitter phase, as any temporal image does, and a whole
 * round of the cycle's phases must ask nothing: every phase then finds every tile it reads
 * resident. A tile whose
 * level is still being read is waited for; a refused tile is not — the pool is full for this view,
 * nothing will come, the coarse level holds (`textureTilesRefused`). The pool never yields what the
 * previous image was looking at, so a turn cannot undo the previous turn: the barrier converges or
 * refuses, it does not spin on itself.
 *
 * Nothing is released here: a tile stays resident until the pool, full, yields the least looked-at
 * — the GPU queue's rule (`../../gpu/sort/slotOrder.ts`). A barrier that released what the last
 * image had not named would let a
 * request that wavers from one image to the next — three tiles of a pane, named one image in seven
 * — entered and left on every capture, changed the resource revision and kept the image from
 * settling. An extra tile changes no read: the camera reads the level it asked for, and it is
 * resident. Returns the number of tiles served.
 */
async function convergeTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, pictured: boolean) {
  const { vis, run } = rt
  const textures = vis.textures!
  // Nothing streamed — no texture, or all in their queue —: no feedback can name anything, and the
  // image need not be redone.
  if (textures.feedback.entries === 0) return 0
  let total = 0,
    quiet = 0
  const phasesOf = () => (pictured ? taaPhaseCount(rt) : 1)
  for (let image = 0; image < convergeBound(phasesOf()); image++) {
    renderWebgpuPages(rt, run.lastCamera!)
    await gpuDevice.queue.onSubmittedWorkDone()
    await textures.settled()
    const { served, pending } = textures.pump(run.frame, true)
    total += served
    // A lane that found no place for a tile grows its pool, and the barrier asks again once it
    // has: the pose never settles on a pool still at its floor.
    const held = rt.setup.texturePools?.pool
    await followTexturePressure(rt)
    const grown = rt.setup.texturePools?.pool !== held
    // A served tile is shown only by the next image: we stop only after a round that asked
    // nothing more, or on a wait that nothing will fill. Nothing is deferred under a lifted
    // budget: what is pending waits for its bytes.
    quiet = served || grown ? 0 : quiet + 1
    if (texturesConverged(quiet, phasesOf(), pending, textures.reading)) break
    if (pending) await textures.settled()
  }
  return total
}

/**
 * Drains shadow maps: images are rendered until the virtual shadow maps settle
 * (`shadowsUnsettled`), whatever staled their pages: an arriving tile, a moving camera or a
 * geometry page that entered or left. Each image's loads are awaited, and a page made resident
 * after the last image draws one more, so its arrivals reach the maps here and not in the first
 * still frame after the barrier. Returns the number of frames drained.
 */
async function drainShadows(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { lights, services } = rt
  const revision = () => rt.gpu.cache?.residencyRevision
  let drains = 0,
    seen = revision()
  const again = () => drainsAgain(seen, revision(), () => shadowsUnsettled(lights))
  for (; drains < SHADOW_DRAIN_LIMIT && again(); drains++) {
    renderWebgpuPages(rt, rt.run.lastCamera!)
    seen = revision()
    await gpuDevice.queue.onSubmittedWorkDone()
    await services.residency.pending
  }
  return drains
}

/**
 * A drained pose: textures converged AND shadows drained, alternating until calm, and the same
 * predicate as the held image (`unsettledMask`) to say whether it is acquired. Order alone is not
 * enough: what a foliage shadow asks of textures is read at the sun levels
 * (`../../visibility/shader/request.ts`), and a page redrawn by the drain moves that request; an arrived
 * tile, conversely, voids every shadow. A turn whose drain redrew nothing has converged its textures
 * on the final pages: that is the stop.
 *
 * These images are ordinary images of the pose (`textureConverging`): every pixel speaks, the
 * temporal pass runs on them as on any other, none is held. What the barrier did, and what still keeps the pose
 * from settling, goes in one diagnostic, `pose-settle`.
 */
export async function settlePose(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice | undefined,
  pictured: boolean,
) {
  const { run, vis, capture, diag } = rt
  if (!gpuDevice || !run.lastCamera || run.lost || capture.capturing) return
  let rounds = 0,
    served = 0,
    drains = 0
  run.textureConverging = true
  try {
    // Cluster records the per-image time budget left owed are part of the pose: a barrier image,
    // with the budget lifted, writes them all, and the GPU cut the barrier then adopts sees every
    // page.
    if (rt.services.clustersOwed()) {
      renderWebgpuPages(rt, run.lastCamera)
      await gpuDevice.queue.onSubmittedWorkDone()
    }
    for (; rounds < POSE_ROUNDS; rounds++) {
      if (vis.textures) served += await convergeTextures(rt, gpuDevice, pictured)
      const drained = await drainShadows(rt, gpuDevice)
      drains += drained
      if (!drained) break
    }
  } finally {
    run.textureConverging = false
  }
  const mask = unsettledMask(rt)
  if (served || drains || mask & (TEXTURES_PENDING | SHADOWS_PENDING))
    diag.engineDiagnostic('pose-settle', 'What the barrier did to settle the image', {
      rounds,
      tilesServed: served,
      shadowFrames: drains,
      reasons: unsettledReasons(mask),
    })
}
