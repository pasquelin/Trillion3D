// The runtime, census and class helpers the frame-pipeline tests share.
import { keepWebgpuFrame } from './hold.ts'
import { settledRt } from './hold.fixture.ts'
import { gatedDevice } from '../../lighting/deferred/gatedDevice.fixture.ts'
import { createWebgpuShadePipelines } from '../../visibility/passes/shadePipelines.ts'
import type { ShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import type { GraphSurface } from '../../materials/graph/surfaceProgram.ts'

/** A settled runtime on a gated device, its hold armed by two identical frames. */
export function armed() {
  const gpu = gatedDevice(),
    rt = settledRt()
  Object.assign(rt.gpu, { device: gpu.device })
  // The coplanar layers the session draws (`WebgpuVisState.drawLayerSlots`).
  Object.assign(rt.vis, { drawLayerSlots: 1 })
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  return { ...gpu, rt }
}

/** A census whose classes and emission the test sets, taken anew once moved. */
export function census(keys: number[], emits = false) {
  let stale = false
  return {
    keys,
    emits,
    surfaces: [] as GraphSurface[],
    moved: () => void (stale = true),
    retake: () => (stale ? !(stale = false) : false),
  } satisfies ShadeCensus
}

/** The scene's resolve classes, compiled as prepare leaves them: writing the feedback, which their
 *  one module's override `FEEDBACK` says (`feedbackConstants`). */
export async function classes(
  gpu: ReturnType<typeof gatedDevice>,
  keys: number[],
  emissiveAo = true,
) {
  let done = false
  const module = {} as GPUShaderModule
  const made = createWebgpuShadePipelines(
    gpu.device,
    module,
    keys,
    undefined,
    true,
    undefined,
    emissiveAo,
  ).finally(() => (done = true))
  while (!done) await gpu.land()
  return (await made).shadeClasses
}

/** A class's compute stage, as the kit's device makes it: its module, entry point and overrides. */
export const stageOf = (pipeline: unknown) => pipeline as GPUProgrammableStage
