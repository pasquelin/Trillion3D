import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../gpu/core/errorScope.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { track } from '../deferred/compileLedger.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { FILTER_GI_BINDING, FILTER_GI_PROGRAM } from './filterWgsl.ts'
import { INTEGRATE_GI_BINDING, INTEGRATE_GI_PROGRAM } from './integrateWgsl.ts'
import { TRANSLUCENCY_GI_FORMAT } from './layout.ts'
import { MARK_GI_BINDING, MARK_GI_PROGRAM } from './markWgsl.ts'
import { TRACE_GI_PROGRAM, traceGiEntries } from './traceWgsl.ts'

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

/** The kernel of `module` on the entries `entries` of its group 0 — and the reflection group (the depth pyramid, the view) as group 1 where
 *  `reflection` — with the entry points `points`. */
async function kernelOf<E extends string>(
  device: GPUDevice,
  label: string,
  module: GPUShaderModule,
  entries: GPUBindGroupLayoutEntry[],
  points: readonly E[],
  reflection: boolean,
  constants?: Record<string, number>,
): Promise<GiKernel<E>> {
  const layout = device.createBindGroupLayout({
    label: `Trillion3D translucency GI ${label}`,
    entries,
  })
  const layouts = reflection ? [layout, reflectionLayout(device)] : [layout]
  return { layout, pipelines: await buildComputeStages(device, layouts, module, points, constants) }
}

/** The four kernels, built together. */
async function createTranslucencyGiKernels(device: GPUDevice): Promise<TranslucencyGiKernels> {
  const f = FILTER_GI_BINDING,
    i = INTEGRATE_GI_BINDING,
    m = MARK_GI_BINDING
  const [mark, trace, filter, integrate] = await Promise.all([
    kernelOf(
      device,
      'MARK',
      await createCheckedShaderModule(device, MARK_GI_PROGRAM, 'TRANSLUCENCY_GI_MARK'),
      [
        computeUniformEntry(m.frame),
        computeUniformEntry(m.grid),
        computeBufferEntry(m.marks, 'storage'),
      ],
      ['markCells'],
      true,
    ),
    kernelOf(
      device,
      'TRACE',
      await createCheckedShaderModule(device, TRACE_GI_PROGRAM, 'TRANSLUCENCY_GI_TRACE'),
      traceGiEntries(),
      ['traceCones'],
      true,
    ),
    kernelOf(
      device,
      'FILTER',
      await createCheckedShaderModule(device, FILTER_GI_PROGRAM, 'TRANSLUCENCY_GI_FILTER'),
      [
        computeUniformEntry(f.frame),
        computeTextureEntry(f.input, 'unfilterable-float', '3d'),
        computeStorageTextureEntry(f.output, TRANSLUCENCY_GI_FORMAT, 'write-only', '3d'),
      ],
      ['filterX', 'filterY', 'filterZ'],
      false,
    ),
    kernelOf(
      device,
      'INTEGRATE',
      await createCheckedShaderModule(device, INTEGRATE_GI_PROGRAM, 'TRANSLUCENCY_GI_INTEGRATE'),
      [
        computeUniformEntry(i.frame),
        computeTextureEntry(i.cones, 'unfilterable-float', '3d'),
        computeTextureEntry(i.history, 'float', '3d'),
        computeSamplerEntry(i.sampler),
        computeStorageTextureEntry(i.volume, TRANSLUCENCY_GI_FORMAT, 'write-only', '3d'),
      ],
      ['integrateCells'],
      true,
    ),
  ])
  return { mark, trace, filter, integrate }
}

/** What a device holds of the kernels: made once, off the frame; the reason the device refused them, when it did. */
interface KernelEntry {
  kernels?: TranslucencyGiKernels
  reason?: string
  /** Whether the refusal was told (`takeTranslucencyGiRefusal`). */
  told?: boolean
}
const entries = new WeakMap<GPUDevice, KernelEntry>()

/** The kernels on `device`, asked of it off the frame the first time (the frames are drawn without the volume while they compile): none
 *  while they compile or if the device refused them (`takeTranslucencyGiRefusal`). */
export function translucencyGiKernels(device: GPUDevice) {
  let entry = entries.get(device)
  if (entry) return entry.kernels
  entry = {}
  entries.set(device, entry)
  const held = entry
  const compile = validatedOrWhy(device, () => createTranslucencyGiKernels(device)).then(
    ({ value, refused }) => {
      if (value) held.kernels = value
      else held.reason = refused ?? 'the device refused the translucency volume'
    },
    (error: unknown) => void (held.reason = String(error)),
  )
  track(device, compile, false)
  return undefined
}

/** Why the device refused the kernels, once: none while they compile, if it did not, or once told. */
export function takeTranslucencyGiRefusal(device: GPUDevice) {
  const entry = entries.get(device)
  if (!entry?.reason || entry.told) return undefined
  entry.told = true
  return entry.reason
}
