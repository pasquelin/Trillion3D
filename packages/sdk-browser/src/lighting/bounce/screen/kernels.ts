import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../../gpu/core/errorScope.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import {
  compositeShader,
  convertShader,
  COMPOSITE_BINDINGS,
  CONVERT_BINDINGS,
} from './gatherWgsl.ts'
import { raysEntries, raysShader } from './importanceWgsl.ts'
import { occlusionShader, OCCLUSION_BINDINGS, type OcclusionShape } from './occlusionWgsl.ts'
import { placeShader, PLACE_BINDINGS } from './placeWgsl.ts'
import { screenDataShader, SCREEN_DATA_BINDINGS } from './screenDataWgsl.ts'
import { adaptiveSamples } from './screenProbeLayout.ts'
import { spatialFilterShader, SPATIAL_BINDINGS } from './spatialWgsl.ts'
import { temporalShader, TEMPORAL_BINDINGS } from './temporalWgsl.ts'
import { traceFieldEntries, traceFieldShader } from './traceFieldWgsl.ts'
import { traceSceneEntries, traceSceneShader } from './traceSceneWgsl.ts'
import { traceScreenEntries, traceScreenShader } from './traceWgsl.ts'

/** What the kernels' code depends on: the rays a side of a probe's octahedron, the samples of a tile an
 *  adaptive probe may stand on, the short-range occlusion's shape, whether the scene is traced. A view's
 *  settings that agree on these share their kernels. */
export interface KernelShape {
  side: number
  samples: readonly [number, number]
  occlusion: OcclusionShape
  scene: boolean
}

/** The shape of the kernels `settings` need. */
export const kernelShapeOf = (settings: ScreenProbeSettings): KernelShape => ({
  side: settings.tracingResolution,
  samples: adaptiveSamples(settings.adaptiveProbes),
  occlusion: {
    downsample: settings.occlusionDownsample,
    pyramid: settings.occlusionPyramid,
    power: settings.occlusionForegroundPower,
  },
  scene: settings.sceneTraces,
})

/** A kernel's source: its WGSL, the entries of its group 0, its entry points, the pipeline constants it needs, and the key
 *  of what its code depends on (`KernelShape`): two shapes that agree on it share the compiled kernel. */
export interface KernelSource<E extends string> {
  key: string
  code: string
  entries: readonly GPUBindGroupLayoutEntry[]
  points: readonly E[]
  constants?: Record<string, number>
}

/** A kernel's source over its WGSL `code`, the `entries` of its group 0 and its entry `points`. */
const sourceOf = <const E extends string>(
  key: string,
  code: string,
  entries: readonly GPUBindGroupLayoutEntry[],
  ...points: E[]
): KernelSource<E> => ({ key, code, entries, points })

/** The dispatch width a source with a list is built at: the device's, where it is not WebGPU's guaranteed one. */
const withList = <E extends string>(source: KernelSource<E>, width: number): KernelSource<E> => {
  const constants = groupWidthConstants(width)
  return constants ? { ...source, constants } : source
}

/** The sources of the trace's three stages — the screen's, the field's and, where asked, the scene's — over `side × side` rays a
 *  probe and `samples` of a tile; the two that read or fill the list of the rays the screen left are built at the device's dispatch
 *  `width`. */
const traceSources = (shape: KernelShape, width: number) => {
  const { side, samples } = shape
  const probes = `${side}x${samples.join('x')}`
  return {
    traceScreen: withList(
      sourceOf(probes, traceScreenShader(side, samples), traceScreenEntries(), 'traceScreen'),
      width,
    ),
    traceField: sourceOf(
      probes,
      traceFieldShader(side, samples),
      traceFieldEntries(),
      'traceField',
    ),
    ...(shape.scene
      ? {
          traceScene: withList(
            sourceOf(probes, traceSceneShader(side, samples), traceSceneEntries(), 'traceScene'),
            width,
          ),
        }
      : {}),
  }
}

/**
 * THE SCREEN PROBES' KERNELS' SOURCES for a shape, in the order `encode.ts` dispatches them: the placement, the screen data, the
 * rays, the screen trace, the field's, the scene's where it is asked, the composite, the spatial filter, the conversion, the
 * short-range occlusion and the temporal pass (which integrates). `width` is the device's dispatch width.
 */
export const screenProbeSources = (shape: KernelShape, width = groupWidth()) => {
  const { side, samples, occlusion } = shape
  const probes = `${side}x${samples.join('x')}`
  return {
    place: sourceOf(
      `${samples}`,
      placeShader(samples),
      PLACE_BINDINGS.entries,
      'placeUniform',
      'probeArgs',
      'adaptiveMark',
      'adaptiveSpawn',
    ),
    screenData: sourceOf(
      `${samples}`,
      screenDataShader(samples),
      SCREEN_DATA_BINDINGS.entries,
      'screenData',
    ),
    rays: sourceOf(probes, raysShader(side, samples), raysEntries(), 'genRays'),
    ...traceSources(shape, width),
    composite: sourceOf(
      probes,
      compositeShader(side, samples),
      COMPOSITE_BINDINGS.entries,
      'composite',
    ),
    spatial: sourceOf(
      probes,
      spatialFilterShader(side, samples),
      SPATIAL_BINDINGS.entries,
      'spatialFilter',
    ),
    convert: sourceOf(probes, convertShader(side, samples), CONVERT_BINDINGS.entries, 'convert'),
    occlusion: sourceOf(
      `${samples}|${occlusion.downsample}|${occlusion.pyramid}|${occlusion.power}`,
      occlusionShader(occlusion, samples),
      OCCLUSION_BINDINGS.entries,
      'occlusion',
    ),
    temporal: sourceOf(
      `${samples}|${occlusion.downsample}`,
      temporalShader(occlusion.downsample, samples),
      TEMPORAL_BINDINGS.entries,
      'temporal',
    ),
  }
}

/** A kernel: its group's layout, and its pipelines by entry point. */
export interface Kernel<E extends string> {
  layout: GPUBindGroupLayout
  pipelines: Record<E, GPUComputePipeline>
}

/** The screen probes' kernels, compiled: each its layout and pipelines (the scene's only where it is asked). */
export interface ScreenProbeKernels {
  place: Kernel<'placeUniform' | 'probeArgs' | 'adaptiveMark' | 'adaptiveSpawn'>
  screenData: Kernel<'screenData'>
  rays: Kernel<'genRays'>
  traceScreen: Kernel<'traceScreen'>
  traceField: Kernel<'traceField'>
  traceScene?: Kernel<'traceScene'>
  composite: Kernel<'composite'>
  spatial: Kernel<'spatialFilter'>
  convert: Kernel<'convert'>
  occlusion: Kernel<'occlusion'>
  temporal: Kernel<'temporal'>
}

/** The kernel of `source` as `label` names it: its module, its layout, its pipelines on that layout and the reflection group
 *  (the depth pyramid, the last image, the view) as group 1. */
async function buildKernel(
  device: GPUDevice,
  label: string,
  source: KernelSource<string>,
): Promise<Kernel<string>> {
  const module = await createCheckedShaderModule(device, source.code, `SCREEN_PROBE_${label}`)
  const layout = device.createBindGroupLayout({
    label: `Trillion3D screen probes ${label}`,
    entries: [...source.entries],
  })
  const pipelines = await buildComputeStages(
    device,
    [layout, reflectionLayout(device)],
    module,
    source.points,
    source.constants,
  )
  return { layout, pipelines }
}

/**
 * THE KERNELS asked, compiled together off the thread in one scope (`validatedOrWhy`): `wanted` by name, each the kernel of its
 * source. The result is the kernels by name, or why the device refused them.
 */
export function compileScreenProbeKernels(
  device: GPUDevice,
  wanted: readonly (readonly [string, KernelSource<string>])[],
) {
  return validatedOrWhy(device, async () => {
    const built = await Promise.all(
      wanted.map(([name, source]) => buildKernel(device, name.toUpperCase(), source)),
    )
    return Object.fromEntries(wanted.map(([name], at) => [name, built[at]]))
  })
}
