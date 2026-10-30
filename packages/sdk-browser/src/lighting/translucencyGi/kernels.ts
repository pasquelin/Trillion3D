import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../gpu/core/errorScope.ts'
import { checkShaderModule } from '../../gpu/core/shaderModule.ts'
import { track } from '../deferred/compileLedger.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { FILTER_GI_BINDING, filterGiProgram } from './filterWgsl.ts'
import { INTEGRATE_GI_BINDING, integrateGiProgram } from './integrateWgsl.ts'
import {
  TRANSLUCENCY_GI_VOLUME_FORMAT,
  translucencyGiAmbientFormat,
  translucencyGiVolumeFormat,
} from './layout.ts'
import { MARK_GI_BINDING, MARK_GI_PROGRAM } from './markWgsl.ts'
import { hasFloat32Filterable } from '../../gpu/core/float32Filterable.ts'
import { traceGiEntries, traceGiProgram } from './traceWgsl.ts'

/** A kernel: its group 0's layout and its pipelines by entry point. */
interface GiKernel<E extends string> {
  layout: GPUBindGroupLayout
  pipelines: Record<E, GPUComputePipeline>
}

/** The volume's kernels, compiled: the mark of the cells' probes, the trace of the cones, the filter's three axes and the integration. */
export interface TranslucencyGiKernels {
  mark: GiKernel<'markCells'>
  trace: GiKernel<'traceCones'>
  filter: GiKernel<'filterX' | 'filterY' | 'filterZ'>
  integrate: GiKernel<'integrateCells'>
}

/** A kernel's module, made now, and its group 0's layout. */
interface GiKernelParts<E extends string> {
  module: GPUShaderModule
  layout: GPUBindGroupLayout
  layouts: GPUBindGroupLayout[]
  points: readonly E[]
}

/** The parts of the kernel `label` on `module`, unchecked: the layout on the entries `entries` of its group 0 — and the
 *  reflection group (the depth pyramid, the view) as group 1 where `reflection` —, with the entry points `points`. Made at once, before
 *  the first `await` of the scope: the validation of an object made after it is out of the scope. */
function partsOf<E extends string>(
  device: GPUDevice,
  label: string,
  module: GPUShaderModule,
  entries: GPUBindGroupLayoutEntry[],
  points: readonly E[],
  reflection: boolean,
): GiKernelParts<E> {
  const layout = device.createBindGroupLayout({
    label: `Trillion3D translucency GI ${label}`,
    entries,
  })
  return {
    module,
    layout,
    layouts: reflection ? [layout, reflectionLayout(device)] : [layout],
    points,
  }
}

/** The kernel of `parts`: its module checked, its pipelines built. */
async function kernelOf<E extends string>(
  device: GPUDevice,
  { module, layout, layouts, points }: GiKernelParts<E>,
): Promise<GiKernel<E>> {
  await checkShaderModule(module, module.label)
  return { layout, pipelines: await buildComputeStages(device, layouts, module, points) }
}

/** The marking pass's parts. */
const markParts = (device: GPUDevice) => {
  const m = MARK_GI_BINDING
  return partsOf(
    device,
    'MARK',
    device.createShaderModule({ label: 'TRANSLUCENCY_GI_MARK', code: MARK_GI_PROGRAM }),
    [
      computeUniformEntry(m.frame),
      computeUniformEntry(m.grid),
      computeBufferEntry(m.marks, 'storage'),
    ],
    ['markCells'],
    true,
  )
}

/** The trace's parts, the cones' light written in `format`, the radiance cache's final maps read in `light`. */
const traceParts = (device: GPUDevice, format: GPUTextureFormat, light: LightAtlasFormat) => {
  // The field's coarse mip is read through the hardware's filter on a device that has `float32-filterable`: the program and the layout say the same.
  const filterableMip = hasFloat32Filterable(device.features)
  return partsOf(
    device,
    'TRACE',
    device.createShaderModule({
      label: 'TRANSLUCENCY_GI_TRACE',
      code: traceGiProgram(format, light, filterableMip),
    }),
    traceGiEntries(format, light, filterableMip),
    ['traceCones'],
    true,
  )
}

/** The filter's parts over cones' light of the format `format`. */
const filterParts = (device: GPUDevice, format: GPUTextureFormat) => {
  const f = FILTER_GI_BINDING
  return partsOf(
    device,
    'FILTER',
    device.createShaderModule({ label: 'TRANSLUCENCY_GI_FILTER', code: filterGiProgram(format) }),
    [
      computeUniformEntry(f.frame),
      computeTextureEntry(f.input, 'unfilterable-float', '3d'),
      computeStorageTextureEntry(f.output, format, 'write-only', '3d'),
    ],
    ['filterX', 'filterY', 'filterZ'],
    false,
  )
}

/** The integration's parts: the ambient light written to the precision that follows from the cones' format, into the volume of the format that follows from it. */
const integrateParts = (device: GPUDevice, format: GPUTextureFormat) => {
  const i = INTEGRATE_GI_BINDING
  const ambientFormat = translucencyGiAmbientFormat(format, device.features)
  const volumeFormat = translucencyGiVolumeFormat(format, device.features)
  return partsOf(
    device,
    'INTEGRATE',
    device.createShaderModule({
      label: 'TRANSLUCENCY_GI_INTEGRATE',
      code: integrateGiProgram(ambientFormat, volumeFormat),
    }),
    [
      computeUniformEntry(i.frame),
      computeTextureEntry(i.cones, 'unfilterable-float', '3d'),
      computeTextureEntry(i.history, 'float', '3d'),
      computeSamplerEntry(i.sampler),
      computeStorageTextureEntry(i.volume, volumeFormat, 'write-only', '3d'),
      computeStorageTextureEntry(i.fog, TRANSLUCENCY_GI_VOLUME_FORMAT, 'write-only', '3d'),
    ],
    ['integrateCells'],
    true,
  )
}

/** The four kernels, built together, the trace and the filter over cones' light of the format `format`, the integration writing the volume
 *  in the format that follows from it (`translucencyGiVolumeFormat`). */
async function createTranslucencyGiKernels(
  device: GPUDevice,
  format: GPUTextureFormat,
  light: LightAtlasFormat,
): Promise<TranslucencyGiKernels> {
  const [mark, trace, filter, integrate] = await Promise.all([
    kernelOf(device, markParts(device)),
    kernelOf(device, traceParts(device, format, light)),
    kernelOf(device, filterParts(device, format)),
    kernelOf(device, integrateParts(device, format)),
  ])
  return { mark, trace, filter, integrate }
}

/** What a device holds of the kernels of a cones' format: made once, off the frame; the reason the device refused them, when it did. */
interface KernelEntry {
  kernels?: TranslucencyGiKernels
  reason?: string
  /** Whether the refusal was told (`takeTranslucencyGiRefusal`). */
  told?: boolean
}
const entries = new WeakMap<GPUDevice, Map<string, KernelEntry>>()

/** The key of the kernels over cones' light of the format `format` and a radiance cache stored in `light`. */
const kernelsKey = (format: GPUTextureFormat, light: LightAtlasFormat) => `${format}|${light}`

/** The kernels on `device` over cones' light of the format `format` and a radiance cache stored in `light`, asked of it off the frame the first time (the frames are drawn without
 *  the volume while they compile): none while they compile or if the device refused them (`takeTranslucencyGiRefusal`). */
export function translucencyGiKernels(
  device: GPUDevice,
  format: GPUTextureFormat,
  light: LightAtlasFormat,
) {
  let ofDevice = entries.get(device)
  if (!ofDevice) entries.set(device, (ofDevice = new Map()))
  const key = kernelsKey(format, light)
  let entry = ofDevice.get(key)
  if (entry) return entry.kernels
  entry = {}
  ofDevice.set(key, entry)
  const held = entry
  const compile = validatedOrWhy(device, () =>
    createTranslucencyGiKernels(device, format, light),
  ).then(
    ({ value, refused }) => {
      if (value) held.kernels = value
      else held.reason = refused ?? 'the device refused the translucency volume'
    },
    (error: unknown) => void (held.reason = String(error)),
  )
  track(device, compile, false, 'translucency volume kernels')
  return undefined
}

/** Why the device refused the kernels over cones' light of `format`, once: none while they compile, if it did not, or once told. */
export function takeTranslucencyGiRefusal(
  device: GPUDevice,
  format: GPUTextureFormat,
  light: LightAtlasFormat,
) {
  const entry = entries.get(device)?.get(kernelsKey(format, light))
  if (!entry?.reason || entry.told) return undefined
  entry.told = true
  return entry.reason
}
