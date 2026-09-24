import { renderWebgpuPages } from '../pages/render/render.ts';
import {
  SHADOWS_PENDING,
  TEXTURES_PENDING,
  unsettledMask,
  unsettledReasons,
} from '../frame/hold.ts';
import { dropTaaHistory } from '../../taa/frame.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Convergence turns at most: beyond that, what is missing is published, never waited for forever. */
const CONVERGE_LIMIT = 64;
/** Images a barrier grants at most to waiting shadow pages, under their budget. A still camera
 *  whose pages have all just been voided by an arrived tile takes a few; a moving camera voids pages
 *  every image and never converges: the bound is there for it. */
const SHADOW_DRAIN_LIMIT = 64;
/** Texture → shadow round-trips at most: each turn that redraws a cascade can move what the shadow
 *  asks of textures, and each arrived tile voids the shadows. */
const POSE_ROUNDS = 4;

/** True when the barrier changed the raster: TAA must restart its still average (#25). */
export const mustRestartTaaAfterSettle = (tilesServed: number, shadowFrames: number) =>
  tilesServed > 0 || shadowFrames > 0;

/**
 * Converges the textures of a pose: the image is rendered with all its pixels on feedback, what they
 * ask is served with no budget, and we start over until no requested tile is missing. A tile whose
 * level is still being read is waited for; a refused tile is not — the pool is full for this view,
 * nothing will come, the coarse level holds (`textureTilesRefused`). The pool never yields what the
 * previous image was looking at, so a turn cannot undo the previous turn: the barrier converges or
 * refuses, it does not spin on itself.
 *
 * Nothing is released here: a tile stays resident until the pool, full, yields the least looked-at
 * — the reference's rule. The barrier used to release what the last image had not named, and a
 * request that wavers from one image to the next — three tiles of a pane, named one image in seven
 * — entered and left on every capture, changed the resource revision and kept the image from
 * settling. An extra tile changes no read: the camera reads the level it asked for, and it is
 * resident. Returns the number of tiles served.
 */
async function convergeTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, run } = rt;
  const textures = vis.textures!;
  // Nothing streamed — no texture, or all in their queue —: no feedback can name anything, and the
  // image need not be redone.
  if (textures.feedback.entries === 0) return 0;
  let total = 0;
  for (let round = 0; round < CONVERGE_LIMIT; round++) {
    renderWebgpuPages(rt, run.lastCamera!);
    await gpuDevice.queue.onSubmittedWorkDone();
    await textures.settled();
    const { served, pending } = textures.pump(run.frame, true);
    total += served;
    // A served tile is shown only by the next image: we stop only on an image that asked nothing more,
    // or on a wait that nothing will fill. Nothing is deferred under a lifted budget: what is
    // pending waits for its bytes.
    if (!served && (!pending || !textures.reading)) break;
    if (pending) await textures.settled();
  }
  return total;
}

/**
 * Drains shadow maps: pending pages — invalidated by an arriving tile, a moving camera or a
 * geometry page that entered or left — are redrawn until none wait. The 1 ms budget stays that
 * of the measured loop: during the barrier it is suspended, otherwise a GPU timestamp arriving
 * mid-drain tightens admission and two identical captures diverge (#25, 0 / 1,392 / 6,278 px).
 * Returns the number of frames drained.
 */
async function drainShadows(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { budget } = rt.lights.plan;
  budget.suspend();
  let drains = 0;
  try {
    for (; drains < SHADOW_DRAIN_LIMIT && rt.lights.plan.counts.pendingPages > 0; drains++) {
      renderWebgpuPages(rt, rt.run.lastCamera!);
      await gpuDevice.queue.onSubmittedWorkDone();
    }
  } finally {
    budget.resume();
  }
  return drains;
}

/**
 * A drained pose: textures converged AND shadows drained, alternating until calm, and the same
 * predicate as the held image (`unsettledMask`) to say whether it is acquired. Order alone is not
 * enough: what a foliage shadow asks of textures is read in the sun cascades
 * (`../../visibility/shader/request.ts`), and a cascade redrawn by the drain moves that request; an arrived
 * tile, conversely, voids every shadow. A turn whose drain redrew nothing has converged its textures
 * on the final cascades: that is the stop.
 *
 * These images replay the last ordinary image (`textureConverging`): every pixel speaks, temporal
 * accumulation does not advance, none is held. What the barrier did, and what still keeps the pose
 * from settling, goes in one diagnostic, `pose-settle`.
 */
export async function settlePose(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice | undefined) {
  const { run, vis, capture, diag } = rt;
  if (!gpuDevice || !run.lastCamera || run.lost || capture.capturing) return;
  let rounds = 0,
    served = 0,
    drains = 0;
  run.textureConverging = true;
  try {
    // Rows the per-image time budget left owed are part of the pose: a barrier image, with the
    // budget lifted, writes them all, and the GPU cut the barrier then adopts sees every page.
    if (rt.services.rowsOwed()) {
      renderWebgpuPages(rt, run.lastCamera);
      await gpuDevice.queue.onSubmittedWorkDone();
    }
    for (; rounds < POSE_ROUNDS; rounds++) {
      if (vis.textures) served += await convergeTextures(rt, gpuDevice);
      const drained = await drainShadows(rt, gpuDevice);
      drains += drained;
      if (!drained) break;
    }
  } finally {
    run.textureConverging = false;
  }
  // Tiles or shadow pages that landed during the barrier changed the raster: the still TAA
  // average must restart from this residency, not mix the frames that were still loading (#25).
  if (mustRestartTaaAfterSettle(served, drains)) dropTaaHistory(rt);
  const mask = unsettledMask(rt);
  if (served || drains || mask & (TEXTURES_PENDING | SHADOWS_PENDING))
    diag.engineDiagnostic('pose-settle', 'What the barrier did to settle the image', {
      rounds,
      tilesServed: served,
      shadowFrames: drains,
      pendingPages: rt.lights.plan.counts.pendingPages,
      reasons: unsettledReasons(mask),
    });
}
