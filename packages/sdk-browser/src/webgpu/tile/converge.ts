import { renderWebgpuPages } from '../pages/render/render.ts';
import {
  SHADOWS_PENDING,
  TEXTURES_PENDING,
  unsettledMask,
  unsettledReasons,
} from '../frame/hold.ts';
import { dropTaaHistory } from '../../taa/frame.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { shadowsUnsettled } from '../pages/state/lights.ts';
import { PICK_CYCLE } from './feedback.ts';
import { shadowsFollowTextures } from '../pages/prepare/lightResources.ts';

/** Convergence images at most: beyond that, what is missing is published, never waited for forever. */
const CONVERGE_LIMIT = 4 * PICK_CYCLE;
/** Images a barrier grants at most to the shadow pages' round trips: a report read, casters
 *  loaded, pages staled by their arrival. A still camera takes a few; a moving camera voids pages
 *  every image and never converges: the bound is there for it. */
const SHADOW_DRAIN_LIMIT = 64;
/** Texture → shadow round-trips at most: each turn that redraws a sun page can move what the shadow
 *  asks of textures, and each arrived tile voids the shadows. */
const POSE_ROUNDS = 4;

/** True when the barrier changed the raster: TAA must restart its still average (#25). */
export const mustRestartTaaAfterSettle = (tilesServed: number, shadowFrames: number) =>
  tilesServed > 0 || shadowFrames > 0;

/** True once a convergence may stop: `cycle` images in a row asked for nothing new — a whole pick
 *  cycle (`PICK_CYCLE`) before a capture —, and nothing is waited for that will come. */
export const texturesConverged = (
  quietImages: number,
  pending: number,
  reading: boolean,
  cycle = PICK_CYCLE,
) => quietImages >= cycle && (!pending || !reading);

/**
 * Converges the textures of a pose: the image is rendered with all its pixels on feedback, what
 * they ask is served with no budget, and we go on until an image finds no requested tile missing —
 * before a capture, a whole cycle of images turning which map a pixel names (`PICK_CYCLE`). A tile whose
 * level is still being read is waited for; a refused tile is not — the pool is full for this view,
 * nothing will come, the coarse level holds (`textureTilesRefused`). The pool never yields what the
 * previous image was looking at, so a turn cannot undo the previous turn: the barrier converges or
 * refuses, it does not spin on itself.
 *
 * Outside a capture nothing is released: a tile stays resident until the pool, full, yields the
 * least looked-at — the reference's rule. A capture gives back what no image named since the view
 * last moved (`releaseUnnamed`). Returns the number of tiles served and released.
 */
async function convergeTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, capture: boolean) {
  const { vis, run } = rt;
  const textures = vis.textures!;
  // Nothing streamed — no texture, or all in their queue —: no feedback can name anything, and the
  // image need not be redone.
  if (textures.feedback.entries === 0) return 0;
  let total = 0,
    quiet = 0;
  for (let image = 0; image < CONVERGE_LIMIT; image++) {
    renderWebgpuPages(rt, run.lastCamera!);
    textures.feedback.turnPick();
    await gpuDevice.queue.onSubmittedWorkDone();
    await textures.settled();
    const { served, pending } = textures.pump(run.frame, true);
    total += served;
    // A served tile is shown only by the next image: we stop only after a pick cycle that asked
    // nothing more, or on a wait that nothing will fill. Nothing is deferred under a lifted budget:
    // what is pending waits for its bytes.
    quiet = served ? 0 : quiet + 1;
    if (texturesConverged(quiet, pending, textures.reading, capture ? PICK_CYCLE : 1)) break;
    if (pending) await textures.settled();
  }
  return total + (capture ? releaseUnnamed(rt, gpuDevice) : 0);
}

/**
 * Gives back every tile no image named since the view last moved (`viewSince`): once a pick cycle
 * named all a pose reads, what remains is what earlier poses brought in. A shadow cutout reads the
 * finest resident tile under a leaf nobody asked at its level (`maskAlphaWgsl`), and read that:
 * the settled image depended on the way the camera came (#1016). Released colour tiles stale the
 * foliage shadows that read them, as an arriving tile does. Named per pose, not per image, a tile
 * one jitter phase alone asks is kept once named: nothing enters and leaves on every capture.
 */
function releaseUnnamed(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { color, data } = rt.vis.textures!,
    since = rt.run.viewSince;
  const colorSlots = color.release(since),
    released = colorSlots.size + data.release(since).size;
  if (!released) return 0;
  color.flush(gpuDevice);
  data.flush(gpuDevice);
  rt.run.gate.resourcesChanged();
  shadowsFollowTextures(rt.lights, rt.layout.rows, colorSlots);
  return released;
}

/**
 * Drains shadow maps: images are rendered until the pages the image reads are all mapped and
 * drawn — a report of the last one proves it —, whatever staled them: an arriving tile, a moving
 * camera or a geometry page that entered or left. Each image's request report is awaited before
 * the next is planned; each image draws every page it marks (`admit.ts`), so what the drain waits
 * for is the report's round trip, never a page queue. Returns the number of frames drained.
 *
 * A drawn page is also a light cut whose report asks for casters: the image after takes it, its
 * casters load, and a caster that enters residency stales the pages over it. The drain waits for
 * each step — the report read, its loads landed — and draws one more image after a report was
 * taken, so its arrivals reach the plan here and not in the first still frame after the barrier.
 */
async function drainShadows(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { lights, services } = rt;
  let drains = 0,
    offered = false;
  for (; drains < SHADOW_DRAIN_LIMIT && (offered || shadowsUnsettled(lights)); drains++) {
    renderWebgpuPages(rt, rt.run.lastCamera!);
    await gpuDevice.queue.onSubmittedWorkDone();
    await lights.pageRequests?.settled();
    await lights.lightCut?.settled();
    offered = !!lights.lightCut?.reports.takeOffered();
    await services.residency.pending;
  }
  return drains;
}

/**
 * A drained pose: textures converged AND shadows drained, alternating until calm, and the same
 * predicate as the held image (`unsettledMask`) to say whether it is acquired. Order alone is not
 * enough: what a foliage shadow asks of textures is read at the sun levels
 * (`../../visibility/shader/request.ts`), and a page redrawn by the drain moves that request; an arrived
 * tile, conversely, voids every shadow. A turn whose drain redrew nothing has converged its textures
 * on the final pages: that is the stop.
 *
 * These images replay the last ordinary image (`textureConverging`): every pixel speaks, temporal
 * accumulation does not advance, none is held. What the barrier did, and what still keeps the pose
 * from settling, goes in one diagnostic, `pose-settle`. `forCapture` false — a wait for pages that
 * reads no image back — converges on the first quiet image and releases nothing.
 */
export async function settlePose(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice | undefined,
  forCapture = true,
) {
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
      if (vis.textures) served += await convergeTextures(rt, gpuDevice, forCapture);
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
