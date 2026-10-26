import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { anyMoving } from './poolStates.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import { routedFilter } from '../../blend/display/displayFilter.ts'
import { particleCode } from '../particleFamily.ts'
import { opensDisplayFilter } from '../../frame/render/encodeDisplayFilter.ts'
import { keepsBeautyChain } from '../../visibility/shader/shadeMode.ts'
import { viewClipPlane } from '../../frame/render/viewClip.ts'
import { openTranslucency } from '../../blend/drawColour.ts'
import { anyDrawn } from '../drawWords.ts'
import { holdoutOn, holdoutPassOn } from '../../frame/prepare/alphaHoldout.ts'

/** True while one of the world's pools moves: the image changes, and is not held. */
export const particlesMoved = (rt: WebgpuPagesRuntime) => anyMoving(rt.context.particles)

/** The world's pools on this image, stepped in the image's command buffer ahead of its
 *  transparent stage, which draws them into the translucency target (#755, `drawParticles`), once
 *  a frame whatever the views drawn. */
export function encodeParticles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const pools = rt.context.particles
  // Once made, the step runs with no pool left too: it gives a released pool's buffers back.
  if (!pools || (!pools.length && !rt.gpu.particles)) return
  // One step a frame, the main view's: a view drawn beside it draws the pools as they stand. The
  // step was made at the frame's entry (`askParticles`).
  if (rt.views.active !== rt.views.main || !rt.gpu.particles) return
  rt.run.gpuComputeDispatches += rt.gpu.particles.run(pools, encoder)
}

/** At a frame's entry (`../../frame/loop/framePipelines.ts`): the world's pools' step, made by the
 *  main view's first frame with a pool, its code arrived, its pipelines compiling from then; and
 *  those routed through the display layers asked once the image can route a pool, the frame held
 *  until they land. */
export function askParticles(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!rt.context.particles?.length || rt.views.active !== rt.views.main) return
  if (!rt.gpu.particles) {
    // The step's code, which the frame waited for (`../../session/host/families.ts`).
    const fail = (error: unknown) => rt.diag.diagnosticFailure('particles-unavailable', error)
    const code = particleCode()
    if (!code) return
    rt.gpu.particles = code.createWebgpuParticles(device, fail, rt.setup.clipping)
  }
  if (!drawsParticles(rt)) return
  if (opensDisplayFilter(rt)) rt.gpu.particles.askRouted()
  // The pools lay the holdout where only the layers' own blending asks it (`encodeAlphaHoldout`).
  if (holdoutPassOn(rt) && !holdoutOn(rt)) rt.gpu.particles.askHoldout()
}

/** Whether this image draws the world's pools: it has some, and shows beauty, its chain whole
 *  (`keepsBeautyChain`). */
const drawsParticles = (rt: Pick<WebgpuPagesRuntime, 'context' | 'run'>) =>
  !!rt.context.particles && keepsBeautyChain(rt.run.diagnostic)

/** The stepped pools into the translucency target, in beauty, with the blends of the layers
 *  (`BLENDS`); `tone`, the scale, curve and pre-exposure (`directTiles`), shows a routed disc. With
 *  `passes`, the pools of that set of passes of the image alone (`ParticlePool.translucencyPass`, the
 *  bits of `translucencyPassBit`), every pool without. The target is opened (`openTranslucency`) once a pool draws: none, no pass.
 *  With `holdout`, the alpha holdout's target (`../../blend/holdout.ts`), the premultiplied pools lay what they let through
 *  there instead. */
export function drawParticles(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  tone: ArrayLike<number>,
  passes?: number,
  holdout?: GPUTextureView,
) {
  const { depthView, particles } = rt.gpu,
    { run, context } = rt
  const pools = context.particles
  if (!pools || !particles || !depthView || !run.lastCamera) return
  if (!drawsParticles(rt)) return
  const eye = run.gate.cam.eye
  if (!anyDrawn(pools, passes)) return
  // Into the alpha holdout's target the pools draw into no translucency target of their own.
  const target = holdout ?? openTranslucency(rt, encoder)
  if (!target) return
  run.gpuDrawCalls += particles.draw(pools, {
    encoder,
    target,
    depth: depthView,
    passes,
    size: rt.gpu.targetSize,
    viewProj,
    world: run.gate.cam.world,
    eye,
    filter: routedFilter(rt.gpu.displayFilter),
    tone,
    bake: rt.gpu.deferred?.toneLut.words,
    unlit: rt.lights.store.unlit,
    clipPlane: viewClipPlane(rt, run.gate.cam),
    holdout,
  })
}
