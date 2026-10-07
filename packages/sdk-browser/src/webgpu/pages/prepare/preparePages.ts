import { createDeferredLighting } from '../../../lighting/deferred/deferred.ts'
import { prepareTemporalAntialiasing } from '../../../taa/prepare.ts'
import { createSceneLightContractBuffer } from '../state/lightBuffer.ts'
import { createGpuPresenter } from '../../../gpu/core/presentation.ts'
import { grantCapability } from '../io/drops.ts'
import { throwIfStopped } from '../io/lost.ts'
import { litPrograms } from './contractLight.ts'
import { type WebgpuPagesRuntime } from '../runtime.ts'
import { loadImpostorCode } from '../../../impostor/code.ts'
import { REFLECTION_MIP_KEYS, prepareMipPipelines } from '../../../texture/mips.ts'
import * as impostorLent from '../../impostor/lent.ts'
import {
  finishPreparation,
  prepareGeometryAndBlend,
  prepareMaterials,
  type PrepareStep,
} from './preparePhases.ts'

/** Builds every GPU resource an image needs, once; `gpuDevice` is then kept as `gpu.device`. A
 *  backend closed or a device lost starts no further step; the teardown releases what steps built. */
export async function prepareWebgpuPages(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const step: PrepareStep = (name, work) => {
    throwIfStopped(rt)
    rt.context.preparationStep?.(name)
    return work()
  }
  // The impostor draw's code, on its way beside every step below, awaited before the first image.
  const impostorCode = loadImpostorCode(rt.context, impostorLent)
  // The reflection pyramids' reductions, compiled off the thread beside every step below, before
  // the frame targets that hold the pyramids are made (`../../../reflections/conePyramid.ts`); one
  // refused is refused again where a pyramid is made, as it was.
  const reflectionMips = prepareMipPipelines(gpuDevice, REFLECTION_MIP_KEYS).catch(() => {})
  await preparePrograms(rt, gpuDevice, step)
  preparePresenter(rt, gpuDevice)
  await prepareGeometryAndBlend(rt, gpuDevice, step)
  await prepareMaterials(rt, gpuDevice, step, { impostorCode, reflectionMips })
  await finishPreparation(rt, gpuDevice, step)
}

/** The scene's light buffer, then the lit and antialiasing programs, each kept as built. */
async function preparePrograms(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, step: PrepareStep) {
  const { gpu, run, diag } = rt
  const lightBuffer = createSceneLightContractBuffer((gpu.device = gpuDevice), rt.lights.store)
  rt.lights.buffer = lightBuffer
  // No more light written into the scene: opaques and transparents read the same declared-light buffer.
  diag.engineDiagnostic('scene-lighting', 'Scene lights active', {
    version: 1,
    contractLights: rt.lights.store.count,
    sceneGraphLights: false,
    implicitAmbient: false,
    shadows: false,
    globalIllumination: false,
  })
  // The lit program starts now, beside every other program, and prepare ends once it landed: the
  // first image is lit, never the unlit stand-in (#1362). Its later arrival (a light turned on) is a
  // new resource, or a held image would stay as it was. Both are awaited, each kept as built.
  const programs = await step('lighting and antialiasing programs', () =>
    Promise.allSettled([
      createDeferredLighting(gpuDevice, () => run.gate.resourcesChanged(), litPrograms(rt)),
      prepareTemporalAntialiasing(rt, gpuDevice),
    ]),
  )
  const [deferred] = programs
  if (deferred.status === 'fulfilled') gpu.deferred = deferred.value
  for (const program of programs) if (program.status === 'rejected') throw program.reason
}

/** The host canvas, or else one of the engine's own, published as `presentedSurface`. */
function preparePresenter(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { gpu, context, diag, capabilities } = rt
  const surface = context.gpuCanvas ?? globalThis.document?.createElement('canvas')
  gpu.presenter = surface && createGpuPresenter(gpuDevice, surface)
  if (gpu.presenter) grantCapability(capabilities, 'direct WebGPU present')
  diag.engineDiagnostic('gpu-presentation', 'GPU presentation initialised', {
    mode: context.gpuCanvas ? 'direct-canvas' : gpu.presenter ? 'offscreen-canvas' : 'texture-only',
    imageReadbackDuringRender: false,
  })
}
