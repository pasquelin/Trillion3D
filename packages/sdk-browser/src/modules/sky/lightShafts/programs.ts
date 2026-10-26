import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { describeLightShaftPass, type LightShaftPass } from './describe.ts'
import { lightShaftPassSizes } from './layout.ts'
import { describeLightShaftTemporal } from './temporalDescribe.ts'
import { lightShaftTemporalProgram } from './temporalWgsl.ts'
import { lightShaftProgram } from './wgsl.ts'

/** Every pass the chains draw, the temporal filter besides. */
const LIGHT_SHAFT_PASS_NAMES = ['occlusion', 'bloom', 'blur', 'finish', 'apply'] as const

/** What a pass is made from: its code, fragment entry, group entries and target. */
interface PassDescription {
  readonly fragmentEntry: string
  readonly entries: GPUBindGroupLayoutEntry[]
  readonly target: GPUColorTargetState
}

/** The sizes the descriptions are asked at: what a pass binds and draws does not depend on them. */
const NOMINAL = lightShaftPassSizes({ width: 1, height: 1 }, { width: 1, height: 1 }, 1)

/**
 * THE LIGHT SHAFTS' PROGRAMS, once a device: one pipeline for each pass (`describe.ts`) and one for
 * the temporal filter (`temporalDescribe.ts`), each with the layout of its one group, prepared off
 * the thread — the frame is held until the ones a chain draws have landed (`PreparedPipeline.ask`) —,
 * and the sampler the shafts' images are read through.
 */
export const lightShaftPrograms = oncePerDevice((device: GPUDevice) => {
  const passModule = device.createShaderModule({
    label: 'Trillion3D light shafts',
    code: lightShaftProgram,
  })
  const temporalModule = device.createShaderModule({
    label: 'Trillion3D light shafts temporal',
    code: lightShaftTemporalProgram,
  })
  const made = (label: string, module: GPUShaderModule, d: PassDescription) => {
    const layout = device.createBindGroupLayout({ label, entries: d.entries })
    return {
      layout,
      pipeline: preparedPipeline(
        device,
        fullscreenDescriptor(device, module, layout, d.fragmentEntry, [d.target], label),
      ),
    }
  }
  const passes = Object.fromEntries(
    LIGHT_SHAFT_PASS_NAMES.map((pass) => [
      pass,
      made(`Trillion3D light shafts ${pass}`, passModule, describeLightShaftPass(pass, NOMINAL)),
    ]),
  ) as Record<LightShaftPass, ReturnType<typeof made>>
  const temporal = made(
    'Trillion3D light shafts temporal',
    temporalModule,
    describeLightShaftTemporal(NOMINAL),
  )
  return {
    passes,
    temporal,
    sampler: postSamplers(device).clamped,
    /** Whether the programs `names` are compiled, asked of the device where they are not. */
    ready: (names: readonly (LightShaftPass | 'temporal')[]) =>
      names.every((name) => (name === 'temporal' ? temporal : passes[name]).pipeline.ask().ready),
  }
})

export type LightShaftPrograms = ReturnType<typeof lightShaftPrograms>
