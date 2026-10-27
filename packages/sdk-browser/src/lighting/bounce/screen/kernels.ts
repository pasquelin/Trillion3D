import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../../gpu/core/errorScope.ts'
import { checkShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import {
  compositeShader,
  convertShader,
  COMPOSITE_BINDINGS,
  CONVERT_BINDINGS,
} from './gatherWgsl.ts'
import { raysEntries, raysShader } from './importanceWgsl.ts'
import { occlusionEntries, occlusionShader, type OcclusionShape } from './occlusionWgsl.ts'
import { placeShader, PLACE_BINDINGS } from './placeWgsl.ts'
import { screenDataShader, SCREEN_DATA_BINDINGS } from './screenDataWgsl.ts'
import { scatterEntries, scatterShader } from './cacheScatterWgsl.ts'
import { adaptiveSamples } from './screenProbeLayout.ts'
import { spatialFilterShader, SPATIAL_BINDINGS } from './spatialWgsl.ts'
import { temporalEntries, temporalShader } from './temporalWgsl.ts'
import { traceSceneEntries, traceSceneShader } from './traceSceneWgsl.ts'
import { traceScreenEntries, traceScreenShader } from './traceWgsl.ts'

/** What the kernels' code depends on: the rays a side of a probe's octahedron and the texels a side they are gathered into, the
 *  samples of a tile an adaptive probe may stand on, the short-range occlusion's shape. A view's settings that agree on these share
 *  their kernels. */
export interface KernelShape {
  /** Whether probes are cast: the kernels over them are made. */
  casts: boolean
  side: number
  gather: number
  samples: readonly [number, number]
  occlusion: OcclusionShape
}

/** The shape of the kernels `settings` need. */
export const kernelShapeOf = (settings: ScreenProbeSettings): KernelShape => ({
  casts: settings.casts,
  side: settings.tracingResolution,
  gather: settings.gatherResolution,
  samples: adaptiveSamples(settings.adaptiveProbes),
  occlusion: {
    downsample: settings.occlusionDownsample,
    pyramid: settings.occlusionPyramid,
    power: settings.occlusionForegroundPower,
    bentNormal: settings.bentNormal,
  },
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

/** The sources of the trace's two stages — the screen's, the scene's: the march through the global distance field and the radiance cache
 *  for the rays it leaves — over `side × side` rays a probe and `samples` of a tile; both read or fill the list of the rays the
 *  screen left, so both are built at the device's dispatch `width`. */
const traceSources = (shape: KernelShape, width: number) => {
  const { side, samples } = shape
  const probes = `${side}x${shape.gather}x${samples.join('x')}`
  return {
    traceScreen: withList(
      sourceOf(probes, traceScreenShader(side, samples), traceScreenEntries(), 'traceScreen'),
      width,
    ),
    traceScene: withList(
      sourceOf(probes, traceSceneShader(side, samples), traceSceneEntries(), 'traceScene'),
      width,
    ),
  }
}

/** The sources of the kernels over the probes: the placement, the screen data, the scatter of their importance into the radiance cache, the rays, the trace's two stages, the composite, the
 *  spatial filter and the conversion, in the order `encode.ts` dispatches them. */
const castSources = (shape: KernelShape, width: number) => {
  const { side, gather, samples } = shape
  const probes = `${side}x${gather}x${samples.join('x')}`
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
    scatter: sourceOf(`${samples}`, scatterShader(samples), scatterEntries(), 'scatterPdf'),
    rays: sourceOf(probes, raysShader(side, gather, samples), raysEntries(), 'genRays'),
    ...traceSources(shape, width),
    composite: sourceOf(
      probes,
      compositeShader(side, gather, samples),
      COMPOSITE_BINDINGS.entries,
      'composite',
    ),
    spatial: sourceOf(
      probes,
      spatialFilterShader(gather, samples),
      SPATIAL_BINDINGS.entries,
      'spatialFilter',
    ),
    convert: sourceOf(
      probes,
      convertShader(side, gather, samples),
      CONVERT_BINDINGS.entries,
      'convert',
    ),
  }
}

/**
 * THE SCREEN PROBES' KERNELS' SOURCES for a shape, in the order `encode.ts` dispatches them: where probes are cast, the placement, the screen
 * data, the scatter, the rays, the screen trace, the scene's, the composite, the spatial filter and the conversion; then,
 * at every level that draws, the short-range occlusion and the temporal pass (which integrates the probes where there are any, and
 * alone keeps the occlusion's history where there are none). `width` is the device's dispatch width.
 */
export const screenProbeSources = (shape: KernelShape, width = groupWidth()) => {
  const { samples, occlusion } = shape
  return {
    ...(shape.casts ? castSources(shape, width) : {}),
    occlusion: sourceOf(
      `${samples}|${occlusion.downsample}|${occlusion.pyramid}|${occlusion.power}|${occlusion.bentNormal}`,
      occlusionShader(occlusion, samples),
      occlusionEntries(occlusion.bentNormal),
      'occlusion',
    ),
    temporal: sourceOf(
      `${samples}|${occlusion.downsample}|${shape.casts}|${occlusion.bentNormal}`,
      temporalShader(occlusion.downsample, samples, shape.casts, occlusion.bentNormal),
      temporalEntries(shape.casts, occlusion.bentNormal),
      'temporal',
    ),
  }
}

/** A kernel: its group's layout, and its pipelines by entry point. */
export interface Kernel<E extends string> {
  layout: GPUBindGroupLayout
  pipelines: Record<E, GPUComputePipeline>
}

/** The kernels over the probes, compiled. */
export interface CastKernels {
  place: Kernel<'placeUniform' | 'probeArgs' | 'adaptiveMark' | 'adaptiveSpawn'>
  screenData: Kernel<'screenData'>
  scatter: Kernel<'scatterPdf'>
  rays: Kernel<'genRays'>
  traceScreen: Kernel<'traceScreen'>
  traceScene: Kernel<'traceScene'>
  composite: Kernel<'composite'>
  spatial: Kernel<'spatialFilter'>
  convert: Kernel<'convert'>
}

/** The screen probes' kernels, compiled: the pixels' two, and those over the probes where the level casts them. */
export interface ScreenProbeKernels {
  cast?: CastKernels
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
  // The module and the layouts are made before the first `await`, in the scope of `compileScreenProbeKernels`.
  const moduleLabel = `SCREEN_PROBE_${label}`
  const made = device.createShaderModule({ label: moduleLabel, code: source.code })
  const layout = device.createBindGroupLayout({
    label: `Trillion3D screen probes ${label}`,
    entries: [...source.entries],
  })
  const layouts = [layout, reflectionLayout(device)]
  const module = await checkShaderModule(made, moduleLabel)
  const pipelines = await buildComputeStages(
    device,
    layouts,
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
