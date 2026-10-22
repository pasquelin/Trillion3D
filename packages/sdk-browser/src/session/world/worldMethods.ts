import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs/jobs.ts'
import { worldSceneMethods } from './sceneMethods.ts'
import { awaitViewPages } from './session.ts'
import { worldBudget } from './budget.ts'
import { worldTelemetry } from './telemetry.ts'
import { worldMaterialMethods } from './materials/materialMethods.ts'
import type { WorldParts } from './worldParts.ts'

/** The world's parts and methods: physics, budget, diagnostic, guides, materials, nodes, frames,
 *  pages, and its disposal. */
export function worldMethods(parts: WorldParts) {
  const { canvas, frames, pools, state, invalidate, diagnostic, switches } = parts
  const { runtime, physics, controls, ahead, live } = parts
  return {
    /** Bodies, gravity and time of the physics (Jolt, in a worker). */ physics: physics.handle,
    /** The world's memory pools, read and set in bytes, and the physics envelopes. */
    budget: worldBudget(pools, runtime, frames, physics.budget),
    diagnostic: diagnostic.handle,
    /** Lines, points and helpers drawn over the image (`Guides`). */ guides: switches.guides,
    ...worldMaterialMethods(live, invalidate),
    /** The object a canvas point or a world ray meets, and a node reached by its name
     *  (`worldSceneMethods`): the world's methods over the nodes of its scene. */
    ...worldSceneMethods(() => state.camera, canvas, physics.session, runtime),
    /** Runs a function after every drawn frame, with its time and metrics; returns its remover. */
    onFrame: frames.add,
    /** Runs a function ahead of every drawn frame, with `{ delta, time }`; returns its remover.
     * A frame runs: the camera's controller (unless `controls.autoUpdate` is false or the host
     * leads, `render()`), the clips, the physics, these hooks in their order, the draw, then the
     * `onFrame` hooks. What a hook places — a body on the camera, a cockpit — is drawn in this
     * very frame, never one late. A hook calling `invalidate()` keeps frames coming. */
    beforeFrame: frames.before,
    /** Asks the world's own loop for a new frame after a change it could not see; a world its
     *  page leads draws at its next `render()`. */
    invalidate,
    /** Draws one frame, whoever leads the loop: clips and physics step with it. One the world
     *  cannot draw yet — its session opening, a part of the engine on its way — is drawn once it
     *  can, once however many were asked meanwhile. */
    render() {
      live()
      runtime.render(() => ahead(null))
    },
    /** Tells the world the canvas changed size; unset, it reads the canvas's own size.
     *  @param width - New width, CSS pixels. @param height - New height, CSS pixels. */
    resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      live()?.resize(Math.floor(width), Math.floor(height))
      invalidate()
    },
    ...worldTelemetry(live, () => state.disposed),
    /** Resolves once the pages the current view reads are resident (`awaitViewPages`).
     *  @param options - `onProgress` hears `pages`, `completed` of `total`, as they land. */
    awaitPages: (options?: { onProgress?: (event: JobProgress) => void }) =>
      awaitViewPages(runtime, live, options?.onProgress),
    /** Stops the world and gives back all it took: GPU memory, loop, controls. */ dispose() {
      if (state.disposed) return
      state.disposed = true
      for (const part of [parts.views, controls, physics, runtime]) part.dispose()
      pools.pageCache.clear()
      diagnostic.close()
      frames.clear()
      parts.device.dispose()
      parts.releaseCanvas()
    },
  }
}
