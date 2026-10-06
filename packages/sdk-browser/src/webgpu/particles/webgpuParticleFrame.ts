import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { anyMoving, refuseAll } from '../../particles/poolStates.ts'
import { viewProj } from '../pages/helpers.ts'
import { routedFilter } from '../blend/displayFilter.ts'
import { particleCode } from '../../particles/particleFamily.ts'
import { opensDisplayFilter } from '../pages/render/encodeDisplayFilter.ts'

/** True while one of the world's pools moves: the image changes, and is not held. */
export const particlesMoved = (rt: WebgpuPagesRuntime) => anyMoving(rt.context.particles)

/** The world's pools on this image, stepped in the image's command buffer ahead of its
 *  transparent stage, which draws them (#755), once a frame whatever the views drawn. */
export function encodeParticles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const pools = rt.context.particles
  // Once made, the step runs with no pool left too: it gives a released pool's buffers back.
  if (!pools || (!pools.length && !rt.gpu.particles)) return
  if (!rt.vis.visEnabled) {
    // A capability refusal, told once like WebGL2's (`particlesRefused`); the session goes on.
    if (refuseAll(pools))
      rt.context.particlesRefused?.(
        'PARTICLES_UNSUPPORTED: particles draw on the visibility buffer',
      )
    // A visibility buffer dropped mid-session: the step made before it gives its buffers back.
    rt.gpu.particles?.dispose()
    rt.gpu.particles = undefined
    return
  }
  // One step a frame, the main view's: a view drawn beside it draws the pools as they stand. The
  // step was made at the frame's entry (`askParticles`).
  if (rt.views.active !== rt.views.main || !rt.gpu.particles) return
  rt.run.gpuComputeDispatches += rt.gpu.particles.run(pools, encoder)
}

/** At a frame's entry (`../frame/framePipelines.ts`): the world's pools' step, made by the
 *  main view's first frame with a pool, its code arrived, its pipelines compiling from then; and
 *  those routed through the display layers asked once the image can route a pool, the frame held
 *  until they land. */
export function askParticles(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.context.particles?.length || !rt.vis.visEnabled || rt.views.active !== rt.views.main)
    return
  if (!rt.gpu.particles) {
    // The step's code, which the frame waited for (`../../host/families.ts`).
    const fail = (error: unknown) => rt.diag.diagnosticFailure('particles-unavailable', error)
    const code = particleCode()
    if (!code) return
    rt.gpu.particles = code.createWebgpuParticles(device, fail)
  }
  if (drawsParticles(rt) && opensDisplayFilter(rt)) rt.gpu.particles.askRouted()
}

/** Whether this image draws the world's pools: it has some, and shows beauty. */
export const drawsParticles = (rt: Pick<WebgpuPagesRuntime, 'context' | 'run'>) =>
  !!rt.context.particles && rt.run.diagnostic === 'beauty'

/** What this image draws the pools with, once a camera and the targets are; else `undefined`. */
function particleDrawOf(rt: WebgpuPagesRuntime) {
  const { hdrView, depthView, asIsShare, particles } = rt.gpu
  const pools = rt.context.particles
  if (!pools || !particles || !hdrView || !depthView || !asIsShare || !rt.run.lastCamera) return
  if (drawsParticles(rt)) return { pools, particles, hdrView, depthView, reactive: asIsShare.view }
}

/** The stepped pools over the lit image and its transparents, in beauty, their coverage the reactive
 *  value (`asIsShare.ts`); `tone`, the exposure and curve (`directTiles`), shows a routed disc. */
export function drawParticles(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  tone: ArrayLike<number>,
) {
  const drawn = particleDrawOf(rt),
    { run } = rt
  if (!drawn) return
  run.gpuDrawCalls += drawn.particles.draw(
    drawn.pools,
    encoder,
    drawn.hdrView,
    drawn.reactive,
    drawn.depthView,
    rt.gpu.targetSize,
    viewProj,
    run.gate.cam.eye,
    routedFilter(rt.gpu.displayFilter),
    tone,
    rt.lights.store.unlit,
  )
}
