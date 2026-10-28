import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { askMeter } from '../../post/exposure/frame.ts'
import { askLocalExposure } from '../../post/finish/frame.ts'
import { askChainPrograms } from '../../post/effects/stagePlan.ts'
import { askToneBake } from '../../lighting/toneLut.ts'
import {
  blueNoiseNow,
  blueNoiseRefused,
  blueNoiseTextures,
} from '../../gpu/noise/blueNoiseTextures.ts'
import { track } from '../../lighting/deferred/compileLedger.ts'
import { prepareReserveVsmPipelines } from '../../lighting/shadows/vsm/frame/vsmPlan.ts'
import { beautyImage } from './lit.ts'

/** One pass of no light and no material: what its programs are asked with, off the frame. The promises it returns are awaited by the preparation. */
type GlobalPass = (rt: WebgpuPagesRuntime, device: GPUDevice) => unknown

/**
 * THE PASSES THAT DEPEND ON NO LIGHT AND NO MATERIAL, asked once, at the opening of the session, whether a lamp is in the scene yet or not: the exposure's measure, the tone
 * table, the local exposure, the effects of the chain, the height fog, the blue noise and the shadow maps' pipelines. The shaders every scene shares are compiled before the first
 * image, as the global shaders of an engine are at its start: the lamp a page adds later finds them ready, and no frame is held for them. The same asks are made by the frame once
 * the image is lit (`askFramePipelines`); an explicit `unlit` view asks none.
 */
const GLOBAL_PASSES: readonly GlobalPass[] = [
  askMeter,
  (rt, device) => rt.gpu.deferred && askToneBake(device),
  askLocalExposure,
  (rt, device) => beautyImage(rt) && askChainPrograms(rt, device),
  (rt) => rt.gpu.deferred?.askFog(),
  (_rt, device) => {
    if (!blueNoiseNow(device) && !blueNoiseRefused(device))
      track(device, blueNoiseTextures(device), true, 'blue noise')
  },
  prepareReserveVsmPipelines,
]

/** Asks every global pass, unless the host asked the unlit view itself; resolves once the compiles the passes returned have settled. */
export async function askGlobalPasses(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.lights.store.unlitAsked) return
  const compiling: Promise<unknown>[] = []
  for (const ask of GLOBAL_PASSES) {
    const made = ask(rt, device)
    if (made instanceof Promise) compiling.push(made)
    else if (Array.isArray(made)) compiling.push(...(made as Promise<unknown>[]))
  }
  await Promise.allSettled(compiling)
}
