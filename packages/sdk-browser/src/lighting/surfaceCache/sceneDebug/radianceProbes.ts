import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { lightAtlasSampleType, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { toneReadEntries } from '../../toneLutRead.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { atlasEntry } from '../../bounce/atlas.ts'
import { indirectSourceOf } from '../../bounce/screen/cast.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import {
  skyLightReadBindEntries,
  skyLightReadLayoutEntries,
} from '../../../modules/sky/skyLight/read.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import { POOL_ADAPTIVE } from '../../bounce/pool/poolLayout.ts'
import { runLineKernel } from './gpuLines.ts'
import type { ProbeDebug } from './probeTables.ts'
import { visualizeTonemapBindings } from './visualizeTonemap.ts'
import {
  RADIANCE_PROBE_BINDINGS as B,
  RADIANCE_PROBE_FLAG,
  RADIANCE_PROBE_SKY_LIGHT,
  RADIANCE_PROBE_VIEW_WORDS,
  radianceProbeDrawWgsl,
  radianceProbeListWgsl,
} from './radianceProbesWgsl.ts'

/**
 * THE SPHERES AT THE WORLD'S PROBES (`radianceCacheVisualize`, `radianceProbesWgsl.ts`): for each level the view asks for, a kernel lists the probes and the draw puts a sphere at
 * each, over the display image and behind the surfaces. The probes drawn are those the indirect light reads: the irradiance field's where it gathers the light, else the screen probes'.
 */

const VERTEX_FRAGMENT = 1 | 2
const LABEL = 'Trillion3D debug radiance probes'
/** The spheres of every level are drawn at once: one view uniform, list and arguments for each. */
interface LevelBuffers {
  view: GPUBuffer
  list: GPUBuffer
  args: GPUBuffer
}

/** What the probes drawn are made of: the levels' uniform, the cell table, the maps and the pool's buffers. */
export interface ProbeSource {
  probes: NonNullable<WebgpuPagesRuntime['bounce']['probes']>
  light: LightAtlasFormat
  final: GPUTextureView
  sky: GPUTextureView
  skyKept: boolean
  /** The irradiance maps and the validity of the probes, none where the maps are the radiance cache's. */
  irradiance?: { maps: GPUTextureView; valid: GPUBuffer }
  /** The texels a side of the final maps and the irradiance maps, and the levels of detail of the final maps. */
  resolution: readonly [number, number, number]
}

/** The probes the indirect light reads, none where the world has none. */
export function probeSourceOf(rt: WebgpuPagesRuntime): ProbeSource | undefined {
  const field = rt.bounce.irradianceField
  const settings = screenProbeSettingsOf(rt)
  const fieldProbes = indirectSourceOf(rt) === 'field' ? field : undefined
  const probes = fieldProbes?.probes ?? rt.bounce.probes
  const views = probes?.cache.views
  if (!probes || !views) return undefined
  const maps = fieldProbes?.maps
  const gathered = fieldProbes?.settings?.irradianceField
  return {
    probes,
    light: views.light,
    final: views.final,
    sky: views.sky,
    skyKept: !!settings.cache.skyVisibility && !maps,
    irradiance: maps && { maps: maps.views.irradiance, valid: maps.views.valid },
    resolution: gathered
      ? [gathered.probeResolution, gathered.irradianceResolution, gathered.mipmaps]
      : [settings.cache.resolution, 1, settings.cache.mipmaps],
  }
}

/** The bind group layouts and pipelines for a device and the format the final maps are stored in. */
const kernels = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => {
  const shared = (visibility: number, list: GPUBufferBindingType): GPUBindGroupLayoutEntry[] => [
    computeBufferEntry(B.grid, 'uniform', visibility),
    { ...atlasEntry(B.table), visibility },
    computeBufferEntry(B.view, 'uniform', visibility),
    computeBufferEntry(B.adaptive, 'read-only-storage', visibility),
    computeBufferEntry(B.slots, 'read-only-storage', visibility),
    computeBufferEntry(B.list, list, visibility),
  ]
  const listLayout = device.createBindGroupLayout({
    label: `${LABEL} list`,
    entries: [...shared(COMPUTE, 'storage'), computeBufferEntry(B.args, 'storage')],
  })
  const drawLayout = device.createBindGroupLayout({
    label: `${LABEL} draw`,
    entries: [
      ...shared(VERTEX_FRAGMENT, 'read-only-storage'),
      computeBufferEntry(B.maps, 'uniform', 2),
      computeTextureEntry(B.final, lightAtlasSampleType(light), '2d', 2),
      computeTextureEntry(B.irradiance, 'unfilterable-float', '2d', 2),
      computeBufferEntry(B.valid, 'read-only-storage', 2),
      computeTextureEntry(B.sky, 'unfilterable-float', '2d', 2),
      computeTextureEntry(B.depth, 'depth', '2d', 2),
      computeBufferEntry(B.tone, 'uniform', 2),
      ...toneReadEntries(B.tone + 1, 2),
      ...skyLightReadLayoutEntries(RADIANCE_PROBE_SKY_LIGHT, 2),
    ],
  })
  const list = device.createShaderModule({ label: `${LABEL} list`, code: radianceProbeListWgsl })
  const stage = (entry: string) =>
    preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [listLayout] }),
      list,
      entry,
      undefined,
      `${LABEL} ${entry}`,
    )
  const draw = device.createShaderModule({
    label: `${LABEL} draw`,
    code: radianceProbeDrawWgsl(light),
  })
  return {
    listLayout,
    drawLayout,
    clear: stage('debugRadianceProbeClear'),
    build: stage('debugRadianceProbeBuild'),
    draw: preparedPipeline(device, {
      label: `${LABEL} draw`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      vertex: { module: draw, entryPoint: 'radianceProbeVs' },
      fragment: {
        module: draw,
        entryPoint: 'radianceProbeFs',
        targets: [{ format: DISPLAY_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }).ask(),
  }
})

/** Gives the buffers of a level back. */
const release = (level: LevelBuffers) => {
  level.view.destroy()
  level.list.destroy()
  level.args.destroy()
}

/** The buffers the spheres need and the view's words, kept between images and given back with the view. */
export function createRadianceProbes(device: GPUDevice) {
  const levels: LevelBuffers[] = []
  const dummy = device.createBuffer({
    label: `${LABEL} stand-in`,
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const words = new Float32Array(RADIANCE_PROBE_VIEW_WORDS)
  const uints = new Uint32Array(words.buffer)
  const maps = new Float32Array(12)
  const mapsBuffer = device.createBuffer({
    label: `${LABEL} maps`,
    size: maps.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  let capacity = 0
  const levelBuffers = (level: number, cells: number) => {
    if (cells > capacity) {
      levels.splice(0).forEach(release)
      capacity = cells
    }
    return (levels[level] ??= {
      view: device.createBuffer({
        label: `${LABEL} view ${level}`,
        size: words.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      list: device.createBuffer({
        label: `${LABEL} list ${level}`,
        size: cells * 16,
        usage: GPUBufferUsage.STORAGE,
      }),
      args: device.createBuffer({
        label: `${LABEL} arguments ${level}`,
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
      }),
    })
  }
  return {
    /** Draws the spheres of `view` over `target` (`size` display pixels) seen through `viewProjection`; whether it did. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      viewProjection: ArrayLike<number>,
      view: ProbeDebug,
    ) {
      const source = probeSourceOf(rt)
      const depth = rt.gpu.depthView
      const tone = visualizeTonemapBindings(rt)
      if (!source || !depth || !tone) return false
      const made = kernels(device, source.light)
      const draw = made.draw.get()
      if (!made.clear.get() || !made.build.get() || !draw) return false
      const { cascades } = source.probes
      const adaptive = source.probes.adaptive.probes.size > 4
      const perCell = adaptive ? 1 + POOL_ADAPTIVE.probes : 1
      maps.set([source.resolution[1], 0, 0, 0, 0, 0, source.resolution[0], source.resolution[2]], 0)
      device.queue.writeBuffer(mapsBuffer, 0, maps)
      const flags =
        (source.irradiance ? RADIANCE_PROBE_FLAG.irradiance : 0) |
        (source.skyKept ? RADIANCE_PROBE_FLAG.sky : 0)
      const shown = cascades.levels
        .map((_, level) => level)
        .filter((level) => view.radianceProbeLevel < 0 || view.radianceProbeLevel === level)
      const buffers = shown.map((level) => levelBuffers(level, cascades.cells * perCell))
      shown.forEach((level, at) => {
        words.set(viewProjection, 0)
        uints.set([level, view.radianceProbes, flags, adaptive ? POOL_ADAPTIVE.probes : 0], 16)
        words.set([view.radianceProbeRadius, size[0], size[1], 0], 20)
        device.queue.writeBuffer(buffers[at]!.view, 0, words)
      })
      const common = (level: LevelBuffers): (GPUBindingResource | undefined)[] => [
        { buffer: source.probes.uniform },
        source.probes.table,
        { buffer: level.view },
        undefined,
        { buffer: source.probes.adaptive.probes },
        { buffer: source.probes.adaptive.slots },
        { buffer: level.list },
      ]
      const groups = ceilDiv(cascades.size ** 3, 64)
      for (const level of buffers) {
        const listed = [...common(level), { buffer: level.args }]
        runLineKernel(device, encoder, made.clear, listed, 1)
        runLineKernel(device, encoder, made.build, listed, groups)
      }
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(draw)
      for (const level of buffers) {
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: made.drawLayout,
            entries: [
              ...common(level).flatMap((resource, binding) =>
                resource ? [{ binding, resource }] : [],
              ),
              { binding: B.maps, resource: { buffer: mapsBuffer } },
              { binding: B.final, resource: source.final },
              { binding: B.irradiance, resource: source.irradiance?.maps ?? source.sky },
              { binding: B.valid, resource: { buffer: source.irradiance?.valid ?? dummy } },
              { binding: B.sky, resource: source.sky },
              { binding: B.depth, resource: depth },
              ...tone.resources.map((resource, at) => ({ binding: B.tone + at, resource })),
              ...skyLightReadBindEntries(RADIANCE_PROBE_SKY_LIGHT, skyLightReadOf(rt)),
            ],
          }),
        )
        pass.drawIndirect(level.args, 0)
      }
      pass.end()
      return true
    },
    dispose() {
      levels.splice(0).forEach(release)
      mapsBuffer.destroy()
      dummy.destroy()
    },
  }
}

/** The spheres at the world's probes (`createRadianceProbes`). */
export type RadianceProbes = ReturnType<typeof createRadianceProbes>
