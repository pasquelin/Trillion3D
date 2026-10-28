import type { IrradianceFieldSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { FLAGS_VIEW, viewOf } from '../../../materials/surface/surfaceOutputs.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { reflectionGroupOf } from '../../translucencyGi/image.ts'
import type { GpuBounceProbes } from '../probes/probes.ts'
import {
  FIELD_GATHER_BINDINGS,
  FIELD_GATHER_FORMAT,
  FIELD_GATHER_PARAM_WORDS,
  fieldGatherEntries,
  fieldGatherProgram,
} from './gatherWgsl.ts'
import type { FieldMaps } from './maps.ts'
import { feedbackTileSize, feedbackTileJitter } from './pixelsTile.ts'

const NORMALS_VIEW = viewOf('normalRough')

/** The gather's kernel for a device and the format the cache's final maps are stored in: its group 0 and the reflection group, asked off the frame, none until it is compiled. */
const gatherKernel = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D irradiance field gather',
    entries: fieldGatherEntries(light),
  })
  return {
    layout,
    stage: askedComputeStage(
      device,
      [layout, reflectionLayout(device)],
      fieldGatherProgram(light),
      'fieldGather',
      'Trillion3D irradiance field gather',
      () => undefined,
    ),
  }
})

/** What the gather writes, at the size of the image over the reduction: the diffuse light and the rough specular of each texel (`FIELD_GATHER_FORMAT`). */
export interface FieldPixels {
  readonly diffuse: GPUTextureView
  readonly specular: GPUTextureView
  readonly reduction: number
  /** Encodes the gather over the image, for the probes `probes` and the maps `maps`; whether it did (none while the kernel compiles or the frame lacks the surfaces or the cache). */
  encode(
    rt: WebgpuPagesRuntime,
    encoder: GPUCommandEncoder,
    probes: GpuBounceProbes,
    maps: FieldMaps,
    settings: IrradianceFieldSettings,
    frame: number,
  ): boolean
  dispose(): void
}

/** The gather's parameters: the resolutions, the reduction, the frame, the occlusion bias, the roughness limit and, for the adaptive placement, whether it is on and the pixel of each tile of the feedback that the frame picks. */
function writeGatherWords(
  words: Float32Array,
  settings: IrradianceFieldSettings,
  reduction: number,
  frame: number,
) {
  words[0] = settings.irradianceResolution
  words[1] = settings.occlusionResolution
  words[2] = reduction
  words[3] = frame % 8
  words[4] = settings.occlusionBias
  words[5] = settings.maxRoughnessToEvaluateRoughSpecular
  words[6] = settings.probeResolution
  words[7] = settings.mipmaps
  const tile = feedbackTileSize(settings.feedbackTile)
  const [jitterX, jitterY] = feedbackTileJitter(tile, frame)
  words[8] = settings.adaptivePlacement ? 1 : 0
  words[9] = tile - 1
  words[10] = jitterX
  words[11] = jitterY
}

/** The gather over the reduced image: its group, then the reflection group. */
function dispatchGather(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  reflection: GPUBindGroup,
  reduced: readonly [number, number],
) {
  const pass = encoder.beginComputePass({ label: 'Trillion3D irradiance field gather' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, reflection)
  pass.dispatchWorkgroups(ceilDiv(reduced[0], 8), ceilDiv(reduced[1], 8))
  pass.end()
}

/** The gather's group: the probes' uniform and table, the surfaces' normals and flags, the maps, the cache's final atlas, the parameters and the two outputs. */
function gatherGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  probes: GpuBounceProbes,
  maps: FieldMaps,
  frames: ReturnType<NonNullable<WebgpuPagesRuntime['gpu']['surfaces']>['views']>,
  final: GPUTextureView,
  params: GPUBuffer,
  views: { diffuse: GPUTextureView; specular: GPUTextureView },
) {
  return device.createBindGroup({
    layout,
    entries: namedEntries(FIELD_GATHER_BINDINGS, {
      grid: { buffer: probes.uniform },
      table: probes.table,
      normals: frames[NORMALS_VIEW],
      flags: frames[FLAGS_VIEW],
      irradiance: maps.views.irradiance,
      occlusion: maps.views.occlusion,
      final,
      params: { buffer: params },
      diffuse: views.diffuse,
      specular: views.specular,
      valid: { buffer: maps.views.valid },
      adaptive: { buffer: probes.adaptive.probes },
      misses: { buffer: probes.adaptive.misses },
      slots: { buffer: probes.adaptive.slots },
    }),
  })
}

/** A target of the gather, `reduced` texels. */
const gatherTexture = (device: GPUDevice, reduced: readonly [number, number], label: string) =>
  device.createTexture({
    label: `Trillion3D irradiance field ${label}`,
    size: [...reduced],
    format: FIELD_GATHER_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The gather's textures, parameters and group for an image of `size`, the reduction `reduction`: made again by the holder when either moves. */
export function createFieldPixels(
  device: GPUDevice,
  size: readonly [number, number],
  reduction: number,
): FieldPixels {
  const reduced = [ceilDiv(size[0], reduction), ceilDiv(size[1], reduction)] as const
  const diffuse = gatherTexture(device, reduced, 'diffuse light')
  const specular = gatherTexture(device, reduced, 'rough specular')
  const params = device.createBuffer({
    label: 'Trillion3D irradiance field gather parameters',
    size: FIELD_GATHER_PARAM_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(FIELD_GATHER_PARAM_WORDS)
  const views = { diffuse: diffuse.createView(), specular: specular.createView() }
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    ...views,
    reduction,
    encode(rt, encoder, probes, maps, settings, frame) {
      const { surfaces } = rt.gpu
      const cache = probes.cache.views
      const reflection = reflectionGroupOf(rt)
      if (!surfaces || !cache || !reflection) return false
      const final = cache.final
      const kernel = gatherKernel(device, cache.light)
      if (!kernel.stage.get()) return false
      writeGatherWords(words, settings, reduction, frame)
      device.queue.writeBuffer(params, 0, words)
      const frames = surfaces.views()
      const { next } = identity
      next[0] = probes.uniform
      next[1] = probes.table
      next[2] = frames[NORMALS_VIEW]
      next[3] = frames[FLAGS_VIEW]
      next[4] = final
      next[5] = maps.views.irradiance
      next[6] = maps.views.occlusion
      next[7] = maps.views.valid
      next[8] = probes.adaptive.probes
      next[9] = probes.adaptive.misses
      next[10] = probes.adaptive.slots
      next[11] = kernel.layout
      if (!group || identity.moved())
        group = gatherGroup(device, kernel.layout, probes, maps, frames, final, params, views)
      dispatchGather(encoder, kernel.stage.get()!, group, reflection, reduced)
      return true
    },
    dispose() {
      retire(device, { destroy: () => (diffuse.destroy(), specular.destroy(), params.destroy()) })
    },
  }
}
