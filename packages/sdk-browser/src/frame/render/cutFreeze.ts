import {
  createEngineCamera,
  holdCameraWorld,
  type EngineCamera,
} from '../../camera/engineCamera.ts'
import type { CullStep } from '../../gpu/core/heldCopy.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE MAIN VIEW'S CULL VIEW (`world.diagnostic.freeze`), apart from the camera it draws from: the
 * camera the cut and its occlusion were made from, the last image's when the cut froze. While it
 * stands, the main view's selection uniforms are no longer rewritten (`./gpuCut.ts`), so the cut —
 * its level of detail, its HLOD, its frustum, its occlusion, its requests — stays the one of that
 * camera: its uniforms unchanged, its readback stands and is not taken again
 * (`../../geometry/dag/owner/cutOwner.ts`, `stampMatches`). The transparents' verdicts too: the first frozen image tests once more and keeps
 * them aside, every later one puts them back and tests nothing (`CullStep`,
 * `../../gpu/core/heldCopy.ts`), whatever a view drawn aside wrote in the buffers they share.
 * The image follows the camera that moves on: what the cut submitted and dropped can be walked
 * around, in the x-ray view best (`../../visibility/passes/xray.ts`). The shadow maps' marking and the
 * reflections follow the moving camera; the views drawn aside cut and test as before. Following
 * again rewrites the uniforms, and tests again, at the next image.
 */
export type CullView = { readonly camera: EngineCamera }

/** Freezes the main view's cut at the last image's camera, or follows the camera again. Asked
 *  before the first image, the freeze waits for it (`run.cullPending`, `adoptPendingFreeze`). */
export function freezeWebgpuCut(rt: WebgpuPagesRuntime, frozen: boolean) {
  const { run } = rt
  run.cullPending = frozen && !run.lastCamera
  if (frozen === (run.cullView !== undefined) || run.cullPending) return
  // The camera the uniforms were last written from: the last image's.
  run.cullView = frozen
    ? { camera: holdCameraWorld(createEngineCamera(), run.gate.cam) }
    : undefined
  run.gate.resourcesChanged()
}

/** A freeze asked before the first image, put on the main view's first, once its uniforms were
 *  written from its camera (`./gpuCut.ts`). */
export function adoptPendingFreeze(rt: WebgpuPagesRuntime) {
  if (rt.run.cullPending && rt.views.active === rt.views.main) freezeWebgpuCut(rt, true)
}

/** What the view drawn does with its cut and occlusion: the main view alone freezes. */
export function cullStep(rt: WebgpuPagesRuntime): CullStep {
  if (!rt.run.cullView) return 'follow'
  return rt.views.active === rt.views.main ? 'held' : 'aside'
}
