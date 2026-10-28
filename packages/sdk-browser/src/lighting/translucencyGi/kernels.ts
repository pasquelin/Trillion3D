import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../gpu/core/errorScope.ts'
import { checkShaderModule } from '../../gpu/core/shaderModule.ts'
import { track } from '../deferred/compileLedger.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { FILTER_GI_BINDING, filterGiProgram } from './filterWgsl.ts'
import { INTEGRATE_GI_BINDING, integrateGiProgram } from './integrateWgsl.ts'
import { TRANSLUCENCY_GI_VOLUME_FORMAT, translucencyGiAmbientFormat } from './layout.ts'
import { MARK_GI_BINDING, MARK_GI_PROGRAM } from './markWgsl.ts'
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

/** The four kernels, built together, the trace and the filter over cones' light of the format `format`, the integration writing the ambient
 *  volume in the format that follows from it (`translucencyGiAmbientFormat`). */
async function createTranslucencyGiKernels(
  device: GPUDevice,
  format: GPUTextureFormat,
): Promise<TranslucencyGiKernels> {
  const f = FILTER_GI_BINDING,
    i = INTEGRATE_GI_BINDING,
    m = MARK_GI_BINDING
  const ambientFormat = translucencyGiAmbientFormat(format, device.features)
  const mark = partsOf(
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
  const trace = partsOf(
    device,
    'TRACE',
    device.createShaderModule({ label: 'TRANSLUCENCY_GI_TRACE', code: traceGiProgram(format) }),
    traceGiEntries(format),
    ['traceCones'],
    true,
  )
  const filter = partsOf(
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
  const integrate = partsOf(
    device,
    'INTEGRATE',
    device.createShaderModule({
      label: 'TRANSLUCENCY_GI_INTEGRATE',
      code: integrateGiProgram(ambientFormat),
    }),
    [
      computeUniformEntry(i.frame),
      computeTextureEntry(i.cones, 'unfilterable-float', '3d'),
      computeTextureEntry(i.historyAmbient, 'float', '3d'),
      computeTextureEntry(i.historyDirectional, 'float', '3d'),
      computeSamplerEntry(i.sampler),
      computeStorageTextureEntry(i.ambient, ambientFormat, 'write-only', '3d'),
      computeStorageTextureEntry(i.directional, TRANSLUCENCY_GI_VOLUME_FORMAT, 'write-only', '3d'),
      computeStorageTextureEntry(i.fog, TRANSLUCENCY_GI_VOLUME_FORMAT, 'write-only', '3d'),
    ],
    ['integrateCells'],
    true,
  )
  const [markKernel, traceKernel, filterKernel, integrateKernel] = await Promise.all([
    kernelOf(device, mark),
    kernelOf(device, trace),
    kernelOf(device, filter),
    kernelOf(device, integrate),
  ])
  return { mark: markKernel, trace: traceKernel, filter: filterKernel, integrate: integrateKernel }
}

/** What a device holds of the kernels of a cones' format: made once, off the frame; the reason the device refused them, when it did. */
interface KernelEntry {
  kernels?: TranslucencyGiKernels
  reason?: string
  /** Whether the refusal was told (`takeTranslucencyGiRefusal`). */
  told?: boolean
}
const entries = new WeakMap<GPUDevice, Map<GPUTextureFormat, KernelEntry>>()

/** The kernels on `device` over cones' light of the format `format`, asked of it off the frame the first time (the frames are drawn without
 *  the volume while they compile): none while they compile or if the device refused them (`takeTranslucencyGiRefusal`). */
export function translucencyGiKernels(device: GPUDevice, format: GPUTextureFormat) {
  let ofDevice = entries.get(device)
  if (!ofDevice) entries.set(device, (ofDevice = new Map()))
  let entry = ofDevice.get(format)
  if (entry) return entry.kernels
  entry = {}
  ofDevice.set(format, entry)
  const held = entry
  const compile = validatedOrWhy(device, () => createTranslucencyGiKernels(device, format)).then(
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
export function takeTranslucencyGiRefusal(device: GPUDevice, format: GPUTextureFormat) {
  const entry = entries.get(device)?.get(format)
  if (!entry?.reason || entry.told) return undefined
  entry.told = true
  return entry.reason
}
