import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { PT_AIR_FLAG } from './airMediumWgsl.ts'
import { PT_AIR_DEPTH_BINDINGS, PT_AIR_DEPTH_BLOCK } from './airDepthWgsl.ts'
import type { PathTracingGpu } from './gpuState.ts'
import type { PathTracingPipelines } from './pipelines.ts'

/** The texels of one slice of the table, so that no dispatch integrates more than a few million samples a thread group. */
const SLICE_TEXELS = 512 * 4

/** The slices of the table one image encodes. */
const SLICES_PER_IMAGE = 8

/** How a table `side` texels across is cut: the rows of a slice and the slices. */
function airSlicesOf(side: number) {
  const slice = Math.max(1, Math.floor(SLICE_TEXELS / side))
  return { slice, slices: ceilDiv(side, slice) }
}

/** The bytes of the buffer of the parameters of the slices of a table `side` texels across. */
export const airParameterBytes = (side: number) => airSlicesOf(side).slices * PT_AIR_DEPTH_BLOCK

/** The settings the traced atmosphere reads. */
export interface PathTracingAirSettings {
  readonly pathTracingEnableReferenceAtmosphere: number
  readonly pathTracingAtmosphereOpticalDepthLUTResolution: number
  readonly pathTracingAtmosphereOpticalDepthLUTNumSamples: number
  readonly pathTracingEnableAtmosphereGround: boolean
  readonly pathTracingUseAnalyticTransmittance: boolean
  readonly pathTracingMaxRaymarchSteps: number
  readonly pathTracingVolumeMISMode: number
  readonly pathTracingVisualize: string
}

/** Whether the scene's air is held by the tracer: the setting (-1 follows the view's post process setting, which is off where it sets none) and the scene's atmosphere being on (the first float of its block). Its table stays built while a view of the payload suspends the trace. */
export const airHeld = (settings: PathTracingAirSettings, packed: Float32Array) =>
  settings.pathTracingEnableReferenceAtmosphere === 1 && packed[ATMOSPHERE_SLOT.planet * 4] === 1

/** Whether the paths trace the air: it is held and no view of the payload is being drawn (it traces no volume, and so no cloud). */
export const airTraced = (settings: PathTracingAirSettings, packed: Float32Array) =>
  airHeld(settings, packed) && settings.pathTracingVisualize === 'none'

/**
 * The traced atmosphere's uniform (`PtAtmo`): the atmosphere's block, then the flags, the most steps of a ray in a volume and the table's side. Written at each image; the table is made again, in slices of rows,
 * when the air (its version) or the table's size or samples changed. Returns false while the table's pipeline is still compiling.
 */
export function encodeAir(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  settings: PathTracingAirSettings,
  packed: Float32Array,
  version: number,
) {
  const on = airTraced(settings, packed)
  // The table was made with the tracer's resources, at the side the settings asked while the air is held (one texel when it is not).
  const side = gpu.airDepth.width
  const samples = settings.pathTracingAtmosphereOpticalDepthLUTNumSamples
  const flags =
    (on ? PT_AIR_FLAG.enabled : 0) |
    (settings.pathTracingUseAnalyticTransmittance ? PT_AIR_FLAG.analytic : 0) |
    (settings.pathTracingEnableAtmosphereGround ? PT_AIR_FLAG.ground : 0) |
    (settings.pathTracingVolumeMISMode !== 0 ? PT_AIR_FLAG.volumeLights : 0)
  // The uniform is written when what it holds changed: the air (its version), the flags, the steps, the table's side.
  const uniformKey = `${version}|${flags}|${settings.pathTracingMaxRaymarchSteps}|${side}`
  if (gpu.airUniformKey !== uniformKey) {
    const uniform = new ArrayBuffer(packed.byteLength + 16)
    new Float32Array(uniform).set(packed)
    new Uint32Array(uniform, packed.byteLength).set([
      flags,
      settings.pathTracingMaxRaymarchSteps,
      side,
      0,
    ])
    device.queue.writeBuffer(gpu.atmosphere, 0, uniform)
    gpu.airUniformKey = uniformKey
  }
  const key = `${version}|${side}|${samples}`
  if (!on || gpu.airDepthKey === key) return true
  const stage = pipelines.airDepth.get()
  if (!stage) return false
  const { slice, slices } = airSlicesOf(side)
  // The table is made over several images, a few slices each, so that no submission runs long; its key is kept once the last slice is encoded.
  if (gpu.airDepthBuilding !== key) {
    const params = new Uint32Array((PT_AIR_DEPTH_BLOCK / 4) * slices)
    for (let at = 0; at < slices; at++)
      params.set([side, samples, at * slice, slice], (at * PT_AIR_DEPTH_BLOCK) / 4)
    device.queue.writeBuffer(gpu.airParameters!, 0, params)
    gpu.airDepthBuilding = key
    // The table is half rewritten from here: a key coming back to the old value must not take it for whole.
    gpu.airDepthKey = ''
    gpu.airDepthNext = 0
  }
  const B = PT_AIR_DEPTH_BINDINGS
  const group = gpu.airDepthGroup(
    device,
    pipelines.airDepthLayout,
    [gpu.atmosphere, gpu.airDepthView, gpu.airParameters],
    () => [
      { binding: B.atmosphere, resource: { buffer: gpu.atmosphere } },
      { binding: B.table, resource: gpu.airDepthView },
      { binding: B.params, resource: { buffer: gpu.airParameters!, size: 16 } },
    ],
  )
  const last = Math.min(slices, gpu.airDepthNext + SLICES_PER_IMAGE)
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer air optical depth' })
  pass.setPipeline(stage)
  for (let at = gpu.airDepthNext; at < last; at++) {
    pass.setBindGroup(0, group, [at * PT_AIR_DEPTH_BLOCK])
    pass.dispatchWorkgroups(ceilDiv(side, 8), ceilDiv(slice, 8))
  }
  pass.end()
  gpu.airDepthNext = last
  if (last < slices) return false
  gpu.airDepthKey = key
  return true
}
