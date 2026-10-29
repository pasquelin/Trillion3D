import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { HV_SHADOW_BYTES, type ShadowLight } from './beerShadowMapGpu.ts'
import { HV_AVSM_PARAMS_BYTES } from './liveShadingAvsmWgsl.ts'
import { bufferOf, type State } from './liveShadingState.ts'
import {
  AVSM_BLOCK_ALIGN,
  avsmBlockLayout,
  avsmListBytes,
} from './volumetricShadow/avsmBlockPlan.ts'
import {
  encodeCombineVolumetricShadowMaps,
  encodeCompressVolumetricShadowMap,
} from './volumetricShadow/volumetricShadowEncode.ts'
import { volumetricShadowPassesOf } from './volumetricShadow/volumetricShadowPasses.ts'
import { VG_PARAMS_STRIDE } from './voxelGrid/gridPasses.ts'

type Settings = (field: HeterogeneousVolumeField) => number

/** The precision word an adaptive map's block carries in its header, where a beer map's is 0 (16 bits) or 1 (32): the read tells them apart by it. */
export const AVSM_BLOCK_MARK = 2

/** What the adaptive maps of a frame are made of, from the settings: at least two samples a texel (the list ends with a sample of its own). */
export const avsmSettingsOf = (settings: Settings) => ({
  maxSampleCount: Math.max(settings('heterogeneousVolumesShadowsMaxSampleCount'), 2),
  compress: !!settings('heterogeneousVolumesShadowsUseAvsmCompression'),
  absoluteError: settings('heterogeneousVolumesShadowsAbsoluteErrorThreshold'),
  relativeError: settings('heterogeneousVolumesShadowsRelativeErrorThreshold'),
})

/** The words before the first block of the pack: the count of slices and the offset of each, padded to the alignment. */
const headerWordsOf = (lights: readonly ShadowLight[]) =>
  Math.ceil((2 + Math.max(...lights.map((l) => l.slice), 0)) / AVSM_BLOCK_ALIGN) * AVSM_BLOCK_ALIGN

type Scene = {
  held: State
  device: GPUDevice
  encoder: GPUCommandEncoder
  settings: Settings
  resolution: number
  lights: readonly ShadowLight[]
  built: Map<number, number>
}

/** Read at the call, never at load: node has no GPU globals. */
const STORAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
const UNIFORM = () => GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST

/** The list `k` of a light's map (the volumes' so far in 0 or 1, the one just rendered in 2), `bytes` long. */
const listOf = (c: Scene, rank: number, k: number, bytes: number) =>
  bufferOf(c.held, c.device, `avsm ${rank} list ${k}`, bytes, STORAGE())

/**
 * One volume's turn at the adaptive map of every light (RenderVolumetricShadowMapForLightWithLiveShadingCS, then CombineVolumetricShadowMap,
 * `HeterogeneousVolumesLiveShadingPipeline.cpp:2940-2990`): the allocator of each light is set to one sample a texel (`:2258`; the build's kernel
 * does not read it), the volume's lists are rendered, and, past the first volume, combined with the lists of the volumes before it. Three lists
 * alternate for a light: the volumes' so far, the one just rendered, the combination. `bindFor` gives the group of the render pass for the lists
 * and the parameters, and the light's uniform.
 */
export function encodeAvsmBuild(
  c: Scene & {
    pipeline: GPUComputePipeline
    uniformOf(rank: number): GPUBuffer
    bindFor(avsm: { list: GPUBuffer; params: GPUBuffer }, uniform: GPUBuffer): GPUBindGroup
  },
) {
  const { held, device, encoder, resolution } = c
  const settings = avsmSettingsOf(c.settings)
  const passes = volumetricShadowPassesOf(device, 'rgba16float')
  for (const light of c.lights) {
    const bytes = avsmListBytes(resolution, light.faces, settings.maxSampleCount)
    const lists = [0, 1, 2].map((k) => listOf(c, light.rank, k, bytes))
    const params = bufferOf(
      held,
      device,
      `avsm ${light.rank} parameters`,
      HV_AVSM_PARAMS_BYTES,
      UNIFORM(),
    )
    const allocator = bufferOf(held, device, `avsm ${light.rank} allocator`, 4, STORAGE())
    device.queue.writeBuffer(allocator, 0, new Uint32Array([resolution * resolution]))
    device.queue.writeBuffer(
      params,
      0,
      new Int32Array([settings.maxSampleCount, settings.compress ? 1 : 0]),
    )
    device.queue.writeBuffer(
      params,
      8,
      new Float32Array([settings.absoluteError, settings.relativeError]),
    )
    const done = c.built.get(light.rank) ?? 0
    const pass = encoder.beginComputePass({
      label: 'Trillion3D heterogeneous volume adaptive shadow map',
    })
    pass.setPipeline(c.pipeline)
    pass.setBindGroup(
      0,
      c.bindFor({ list: lists[done === 0 ? 0 : 2], params }, c.uniformOf(light.rank)),
    )
    pass.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8), light.faces)
    pass.end()
    if (done > 0)
      encodeCombineVolumetricShadowMaps({
        device,
        encoder,
        passes,
        resolution: [resolution, resolution],
        faces: light.faces,
        ...settings,
        listA: lists[(done - 1) % 2],
        listB: lists[2],
        combined: lists[done % 2],
        uniform: bufferOf(held, device, `avsm ${light.rank} combine`, VG_PARAMS_STRIDE, UNIFORM()),
      })
    c.built.set(light.rank, done + 1)
  }
}

/**
 * The adaptive maps the builds left, compressed (CompressVolumetricShadowMap, `:3118`) straight into the buffer the lit passes read: per light, a
 * block of the shadow struct's header, then its indirection entries and its atlas (`avsmBlockLayout`), the blocks starting at multiples of 64 words
 * so that a pass can bind the slices. Gives the buffer, none where no light has a map.
 */
export function packAvsmMaps(c: Scene & { uniformOf(rank: number): GPUBuffer }) {
  const { held, device, encoder, resolution } = c
  const lights = c.lights.filter((light) => c.built.get(light.rank))
  if (!lights.length) return undefined
  const settings = avsmSettingsOf(c.settings)
  const passes = volumetricShadowPassesOf(device, 'rgba16float')
  const header = new Uint32Array(headerWordsOf(lights))
  header[0] = Math.max(...lights.map((l) => l.slice)) + 1
  let at = header.length
  const placed = lights.map((light) => {
    const layout = avsmBlockLayout(resolution, light.faces, settings.maxSampleCount)
    header[1 + light.slice] = at
    at += layout.words
    return { light, layout, block: at - layout.words }
  })
  const packed = bufferOf(held, device, 'avsm maps packed', at * 4, STORAGE())
  device.queue.writeBuffer(packed, 0, header)
  const allocator = bufferOf(held, device, 'avsm compress allocator', 4, STORAGE())
  for (const { light, layout, block } of placed) {
    encoder.copyBufferToBuffer(c.uniformOf(light.rank), 0, packed, block * 4, HV_SHADOW_BYTES)
    encodeCompressVolumetricShadowMap({
      device,
      encoder,
      passes,
      resolution: [resolution, resolution],
      faces: light.faces,
      maxSampleCount: settings.maxSampleCount,
      lists: listOf(
        c,
        light.rank,
        ((c.built.get(light.rank) ?? 1) - 1) % 2,
        avsmListBytes(resolution, light.faces, settings.maxSampleCount),
      ),
      allocator,
      indirection: { buffer: packed, offset: (block + 64) * 4, size: layout.indirectionBytes },
      atlas: { buffer: packed, offset: (block + layout.atlasStart) * 4, size: layout.atlasBytes },
      uniform: bufferOf(held, device, `avsm ${light.rank} compress`, VG_PARAMS_STRIDE, UNIFORM()),
    })
  }
  return packed
}
