import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { validatedOrWhy } from '../../../gpu/core/errorScope.ts'
import { checkShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { reflectionSceneLayout, reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { startedTracedKernel } from '../cache/cacheKernels.ts'
import { compositeEntries, compositeShader, convertEntries, convertShader } from './gatherWgsl.ts'
import { FIXUP_BINDINGS, fixupShader, MIP_BINDINGS, mipShader } from './gatherMipsWgsl.ts'
import { raysEntries, raysShader } from './importanceWgsl.ts'
import {
  integrateEntries,
  integrateShader,
  TILE_BINDINGS,
  tileShader,
} from './integratePassWgsl.ts'
import { occlusionEntries, occlusionShader, type OcclusionShape } from './occlusionWgsl.ts'
import { placeShader, PLACE_BINDINGS } from './placeWgsl.ts'
import { PROBE_FILTER_BINDINGS, probeFilterShader } from './probeFilterWgsl.ts'
import { screenDataShader, SCREEN_DATA_BINDINGS } from './screenDataWgsl.ts'
import { adaptiveSamples } from './screenProbeLayout.ts'
import { STOCHASTIC_BINDINGS, stochasticShader } from './stochasticWgsl.ts'
import { spatialEntries, spatialFilterShader } from './spatialWgsl.ts'
import { temporalEntries, temporalShader } from './temporalWgsl.ts'
import { traceSceneEntries, traceSceneShader } from './traceSceneWgsl.ts'
import {
  traceTracedEntries,
  traceTracedSceneEntries,
  traceTracedShader,
} from './traceTracedWgsl.ts'
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
  /** Whether the composited radiance is blended with the last image's (`screenProbeTemporalFilterProbes`). */
  filterProbes: boolean
  /** Whether the probes keep an extra ambient occlusion (`screenProbeExtraAmbientOcclusion`). */
  extraAo: boolean
  /** The levels of detail of the filtered radiance (`screenProbeGatherNumMips`). */
  gatherMips: number
  /** The reduction the integration runs at (`screenProbeIntegrateDownsampleFactor`). */
  integrate: number
  /** Whether the height fog is laid over the light of the probes' rays (`screenProbeHeightFogOnGI`): the scene stages that write it lay it. */
  heightFog: boolean
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
  filterProbes: settings.temporalFilterProbes,
  extraAo: settings.extraAo,
  gatherMips: settings.gatherMips,
  integrate: settings.integrateDownsample,
  heightFog: settings.values.screenProbeHeightFogOnGI,
})

/** The key of the rays a side of a probe, the samples of a tile and whether the fog is laid over the light, which the scene stage cast through the scene's triangles depends on alone. */
export const raysKey = (shape: Pick<KernelShape, 'side' | 'samples' | 'heightFog'>) =>
  `${shape.side}x${shape.samples.join('x')}|${shape.heightFog}`

/** The key of the probes' grids, the rays a side, the texels a side they are gathered into and the samples of a tile, which the kernels over the probes depend on. */
const probesKey = (shape: Pick<KernelShape, 'side' | 'gather' | 'samples'>) =>
  `${shape.side}x${shape.gather}x${shape.samples.join('x')}`

/** The key of the whole shape: two shapes that agree on it share a set of kernels. */
export const shapeKey = (shape: KernelShape) =>
  [
    shape.casts,
    probesKey(shape),
    shape.occlusion.downsample,
    shape.occlusion.pyramid,
    shape.occlusion.power,
    shape.occlusion.bentNormal,
    shape.filterProbes,
    shape.extraAo,
    shape.gatherMips,
    shape.integrate,
    shape.heightFog,
  ].join('|')

/** A kernel's source: its WGSL, the entries of its group 0, its entry points, the pipeline constants it needs, and the key
 *  of what its code depends on (`KernelShape`): two shapes that agree on it share the compiled kernel. */
export interface KernelSource<E extends string> {
  key: string
  code: string
  entries: readonly GPUBindGroupLayoutEntry[]
  points: readonly E[]
  constants?: Record<string, number>
  /** The kernel is a scene stage: its group 1 is the reflection group the scene stages read (`reflectionSceneLayout`), not the whole (`reflectionLayout`). */
  scene?: true
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
 *  for the rays it leaves, which lays the height fog over the light of its rays where the shape asks it — over `side × side` rays a probe and `samples` of a tile;
 *  both read or fill the list of the rays the screen left, so both are built at the device's dispatch `width`. */
const traceSources = (shape: KernelShape, width: number) => {
  const { side, samples, heightFog } = shape
  const probes = probesKey(shape)
  return {
    traceScreen: withList(
      sourceOf(probes, traceScreenShader(side, samples), traceScreenEntries(), 'traceScreen'),
      width,
    ),
    traceScene: withList(
      {
        ...sourceOf(
          `${probes}|${heightFog}`,
          traceSceneShader(side, samples, heightFog),
          traceSceneEntries(heightFog),
          'traceScene',
          'traceFar',
        ),
        scene: true,
      },
      width,
    ),
  }
}

/** The name of the kernel of the level `level` of the filtered radiance, from the first coarser level on. */
const mipName = (level: number) => `mip${level}`

/** The level a kernel of the name `name` makes (`mipName`), none for another kernel. */
export const mipLevelOf = (name: string) => /^mip(\d+)$/.exec(name)?.[1]

/** The sources of the kernels over the probes: the placement, the screen data, the rays, the trace's two stages, the composite, the temporal filter
 *  of the probes, the spatial filter and the conversion, the border and the coarser levels of the filtered radiance, then the classification of the pixels'
 *  tiles, the texel each pixel reads of the integration and the integration of the probes they read, in the order `encode.ts` dispatches them. The temporal filter, the extra ambient occlusion, the
 *  levels and the texel each pixel reads exist where the shape asks them. */
const castSources = (shape: KernelShape, width: number) => {
  const { side, gather, samples, occlusion, filterProbes, extraAo, gatherMips, integrate } = shape
  const probes = probesKey(shape)
  const leveled = `${gather}|${samples}|${gatherMips}`
  const levels = Array.from({ length: gatherMips - 1 }, (_, at) => at + 1)
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
    rays: sourceOf(probes, raysShader(side, gather, samples), raysEntries(), 'genRays'),
    ...traceSources(shape, width),
    composite: sourceOf(
      `${probes}|${extraAo}`,
      compositeShader(side, gather, samples, extraAo),
      compositeEntries(extraAo),
      'composite',
    ),
    ...(filterProbes && {
      probeFilter: sourceOf(
        `${gather}|${samples}`,
        probeFilterShader(gather, samples),
        PROBE_FILTER_BINDINGS.entries,
        'probeFilter',
      ),
    }),
    spatial: sourceOf(
      `${probes}|${extraAo}`,
      spatialFilterShader(gather, samples, extraAo),
      spatialEntries(extraAo),
      'spatialFilter',
    ),
    convert: sourceOf(
      `${probes}|${extraAo}`,
      convertShader(side, gather, samples, extraAo),
      convertEntries(extraAo),
      'convert',
    ),
    ...(gatherMips > 1 && {
      fixup: sourceOf(
        leveled,
        fixupShader(gather, gatherMips, samples),
        FIXUP_BINDINGS.entries,
        'fixup',
      ),
      ...Object.fromEntries(
        levels.map((level) => [
          mipName(level),
          sourceOf(
            leveled,
            mipShader(gather, gatherMips, level, samples),
            MIP_BINDINGS.entries,
            'mip',
          ),
        ]),
      ),
    }),
    tile: sourceOf(
      `${samples}|${integrate}`,
      tileShader(integrate, samples),
      TILE_BINDINGS.entries,
      'tileInit',
      'tileClassify',
      'tileFinish',
    ),
    ...(integrate > 1 && {
      stochastic: sourceOf(
        `${samples}`,
        stochasticShader(samples),
        STOCHASTIC_BINDINGS.entries,
        'stochasticOffsets',
      ),
    }),
    integrate: sourceOf(
      `${samples}|${occlusion.downsample}|${integrate}|${occlusion.bentNormal}|${extraAo}|${gatherMips}`,
      integrateShader(
        occlusion.downsample,
        integrate,
        samples,
        occlusion.bentNormal,
        extraAo,
        gatherMips,
      ),
      integrateEntries(occlusion.bentNormal),
      'integrate',
      'integrateSimple',
    ),
  }
}

/**
 * THE SCREEN PROBES' KERNELS' SOURCES for a shape, in the order `encode.ts` dispatches them: where probes are cast, the placement, the screen
 * data, the rays, the screen trace, the scene's, the composite, the spatial filter and the conversion; then,
 * at every level that draws, the short-range occlusion, and, where probes are cast, the classification of the pixels' tiles and the integration of
 * the probes, and the temporal pass (which blends what the integration left, and alone keeps the occlusion's history where there are none). `width` is the device's dispatch width.
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
      `${samples}|${occlusion.downsample}|${shape.casts}|${occlusion.bentNormal}|${shape.integrate}`,
      temporalShader(
        occlusion.downsample,
        samples,
        shape.casts,
        occlusion.bentNormal,
        shape.integrate,
      ),
      temporalEntries(shape.casts, occlusion.bentNormal, shape.integrate),
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
  rays: Kernel<'genRays'>
  traceScreen: Kernel<'traceScreen'>
  traceScene: Kernel<'traceScene' | 'traceFar'>
  composite: Kernel<'composite'>
  spatial: Kernel<'spatialFilter'>
  convert: Kernel<'convert'>
  /** The temporal filter of the probes (`screenProbeTemporalFilterProbes`), the border of the filtered radiance's finest level and its coarser level
   *  (`screenProbeGatherNumMips` above one): none where the shape asks none. */
  probeFilter?: Kernel<'probeFilter'>
  fixup?: Kernel<'fixup'>
  /** The coarser levels of the filtered radiance, the first level first: none where the gather holds one level. */
  mips: Kernel<'mip'>[]
  tile: Kernel<'tileInit' | 'tileClassify' | 'tileFinish'>
  /** The pass that picks the texel each pixel reads of the integration where it is downsampled (`screenProbeIntegrateDownsampleFactor` above one): none else. */
  stochastic?: Kernel<'stochasticOffsets'>
  integrate: Kernel<'integrate' | 'integrateSimple'>
}

/** What the shape of the kernels says of the options the groups bind by: whether the probes keep an extra ambient occlusion, the temporal filter of
 *  the probes is run, how many levels the gathered radiance holds, the reduction the integration runs at, and whether the fog's reads are bound to the scene stages. */
export type KernelFeatures = Pick<
  KernelShape,
  'extraAo' | 'filterProbes' | 'gatherMips' | 'integrate' | 'heightFog'
>

/** The screen probes' kernels, compiled: the pixels' two, and those over the probes where the level casts them. */
export interface ScreenProbeKernels {
  features: KernelFeatures
  cast?: CastKernels
  occlusion: Kernel<'occlusion'>
  temporal: Kernel<'temporal'>
}

/** The kernel of `source` as `label` names it: its module, its layout, its pipelines on that layout and the reflection group
 *  (the depth pyramid, the last image, the view) as group 1, or, for a scene stage, the part of it the scene stages read (`reflectionSceneLayout`). */
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
  const layouts = [layout, source.scene ? reflectionSceneLayout(device) : reflectionLayout(device)]
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

/** The scene stage that casts its rays through the scene's triangles (`traceTracedWgsl.ts`) for one shape: its layouts — its own group with the
 *  cut's tables, the reflection group the scene stages read, the scene trace's — and its pipeline, read once `ready`. */
export type TracedSceneKernel = ReturnType<typeof tracedSceneKernel>

/**
 * THE TRACED SCENE STAGE'S KERNEL for the rays a side of a probe, the samples of a tile and the fog on the rays of `shape`, made when a scene has acceleration
 * structures (the store keeps it for its shape and device, `ScreenProbeStore.tracedFor`): compiled off the frame and not waited for by the
 * kernels over the probes — until it is `ready` the rays are marched through the global distance field (`traceScene`), as they are where
 * the scene has none.
 */
export function tracedSceneKernel(
  device: GPUDevice,
  shape: Pick<KernelShape, 'side' | 'samples' | 'heightFog'>,
) {
  const label = `Trillion3D SCREEN_PROBE_TRACED ${raysKey(shape)}`
  return startedTracedKernel(
    device,
    label,
    [
      device.createBindGroupLayout({ label, entries: traceTracedEntries(shape.heightFog) }),
      reflectionSceneLayout(device),
      device.createBindGroupLayout({ label, entries: traceTracedSceneEntries() }),
    ],
    traceTracedShader(shape.side, shape.samples, shape.heightFog),
    'traceTriangles',
  )
}
