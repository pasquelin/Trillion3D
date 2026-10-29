import { type WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { noiseViewOn } from '../../gpu/noise/blueNoiseTextures.ts'
import { fogReadOf } from '../../frame/render/localFogGpu.ts'
import { fogReadBindEntries } from '../fog/read.ts'
import { fogGraphMaps } from '../../frame/render/fogGraphMaps.ts'
import { velocityTargetOf } from '../../post/taa/volumeVelocity.ts'
import { type VolumeHoldout } from '../../post/volumeHoldout.ts'
import { vsmOrStandIns } from '../shadows/vsm/frame/vsmConsumers.ts'
import { HV_BINDING, HV_FOG_BINDINGS, svtBindings } from './liveShadingProgram.ts'
import { type BeerBind } from './beerShadowMapGpu.ts'
import { HV_AVSM_PARAMS_BYTES } from './liveShadingAvsmWgsl.ts'
import { type SparseVolumeFrameGpu } from './sparseVolumeGpu.ts'
import { bufferOf, type Program, type State } from './liveShadingState.ts'

/** What a volume's group binds apart from the buffers and images that change from pass to pass. */
export interface VolumeGroupInputs {
  device: GPUDevice
  rt: WebgpuPagesRuntime
  held: State
  program: Program
  vsm: ReturnType<typeof vsmOrStandIns>
  slotsBuffer: GPUBuffer
  valuesBuffer: GPUBuffer
  cache: GPUTexture
  slotsGpu: readonly ({ gpu: SparseVolumeFrameGpu } | undefined)[]
  giView?: GPUTextureView
  atlas?: ReturnType<ReturnType<typeof fogGraphMaps>['atlas']>
  velocity?: ReturnType<typeof velocityTargetOf>
  /** The holdout the volumes that hold out add to, where the program holds one (`liveShadingProgram`). */
  holdout?: VolumeHoldout
  taaStand: GPUBuffer
  fogRead: NonNullable<ReturnType<typeof fogReadOf>>
}

export type Textures = {
  cache?: GPUTexture
  read?: GPUTexture
  ambient?: GPUTexture
  existence?: GPUTexture
  /** The baked extinction, albedo and emission the passes read in place of the material. */
  baked?: readonly [GPUTexture, GPUTexture, GPUTexture]
  /** The buffer of the hierarchy of boxes the march of a program with boxes walks, and the lists and parameters a program that builds the adaptive map writes. */
  boxes?: GPUBuffer
  avsm?: { list: GPUBuffer; params: GPUBuffer }
}

/** The bindings of the extra buffers of a program's variant: the stand-in where the hierarchy or the adaptive map's lists are not there this image. */
function variantEntries(c: VolumeGroupInputs, textures: Textures): GPUBindGroupEntry[] {
  const { program, held, device } = c
  if (program.variant === 'boxes') {
    const stand = bufferOf(held, device, 'boxes stand-in', 256, GPUBufferUsage.STORAGE)
    return [{ binding: HV_BINDING.boxes, resource: { buffer: textures.boxes ?? stand } }]
  }
  if (program.variant === 'avsm') {
    const list =
      textures.avsm?.list ??
      bufferOf(held, device, 'avsm list stand-in', 256, GPUBufferUsage.STORAGE)
    const params =
      textures.avsm?.params ??
      bufferOf(
        held,
        device,
        'avsm parameters stand-in',
        HV_AVSM_PARAMS_BYTES,
        GPUBufferUsage.UNIFORM,
      )
    return [
      { binding: HV_BINDING.avsmList, resource: { buffer: list } },
      { binding: HV_BINDING.avsmParams, resource: { buffer: params } },
    ]
  }
  return []
}

/** The bindings of the lights' shadows (the virtual shadow maps) and the engine's noise: what every pass reads of the scene. */
function sceneEntries(c: VolumeGroupInputs): GPUBindGroupEntry[] {
  const { rt, vsm, device } = c
  return [
    { binding: HV_BINDING.lights, resource: { buffer: rt.lights.buffer! } },
    { binding: HV_BINDING.pageTable, resource: { buffer: vsm.pageTable } },
    { binding: HV_BINDING.projectionData, resource: { buffer: vsm.projectionData } },
    { binding: HV_BINDING.shadowUniforms, resource: { buffer: vsm.uniforms } },
    { binding: HV_BINDING.shadowPool, resource: { buffer: vsm.pool } },
    { binding: HV_BINDING.shadowView, resource: { buffer: vsm.view } },
    { binding: HV_BINDING.blueNoise, resource: noiseViewOn(device) },
  ]
}

/** The bindings of the sparse volumes' slots, the colour atlas of the graph's 2D textures, and the graph's values. */
function graphEntries(c: VolumeGroupInputs): GPUBindGroupEntry[] {
  const { held, slotsBuffer, valuesBuffer, slotsGpu, atlas } = c
  return [
    { binding: HV_BINDING.svtSlots, resource: { buffer: slotsBuffer } },
    ...slotsGpu.flatMap((slot, k) => {
      const t = svtBindings(k)
      return [
        { binding: t.pageTable, resource: (slot?.gpu.pageTable ?? held.standPages!).createView() },
        { binding: t.tilesA, resource: (slot?.gpu.tiles[0] ?? held.stand!).createView() },
        { binding: t.tilesB, resource: (slot?.gpu.tiles[1] ?? held.stand!).createView() },
      ]
    }),
    { binding: HV_BINDING.values, resource: { buffer: valuesBuffer } },
    ...(atlas
      ? [
          { binding: HV_BINDING.atlasPool0, resource: atlas.views[0] },
          { binding: HV_BINDING.atlasPool1, resource: atlas.views[1] },
          { binding: HV_BINDING.atlasPool2, resource: atlas.views[2] },
          { binding: HV_BINDING.atlasPages, resource: { buffer: atlas.pages } },
          { binding: HV_BINDING.atlasSampler, resource: atlas.sampler },
        ]
      : []),
  ]
}

/** The bindings of what a pass writes or reads besides the images: the beer map, the velocity, the translucency volume, the occlusion, the existence mask, the holdout. */
function sideEntries(
  c: VolumeGroupInputs,
  beer: BeerBind,
  textures: Textures,
): GPUBindGroupEntry[] {
  const { held, giView, velocity, taaStand, holdout } = c
  return [
    { binding: HV_BINDING.giVolume, resource: giView ?? held.stand!.createView() },
    { binding: HV_BINDING.shadow, resource: { buffer: beer.uniform } },
    { binding: HV_BINDING.beerPrevious, resource: beer.previous },
    { binding: HV_BINDING.beerOut, resource: beer.out },
    { binding: HV_BINDING.velocity, resource: velocity?.view ?? held.standVelocity!.createView() },
    { binding: HV_BINDING.taaView, resource: { buffer: velocity?.taaView ?? taaStand } },
    { binding: HV_BINDING.ambient, resource: (textures.ambient ?? held.stand!).createView() },
    { binding: HV_BINDING.existence, resource: (textures.existence ?? held.stand!).createView() },
    ...[HV_BINDING.bakedExtinction, HV_BINDING.bakedAlbedo, HV_BINDING.bakedEmission].map(
      (binding, i) => ({
        binding,
        resource: (textures.baked?.[i] ?? held.stand!).createView(),
      }),
    ),
    ...(holdout ? [{ binding: HV_BINDING.holdout, resource: holdout.view }] : []),
  ]
}

/** The bind group of one pass: the cache is written by one dispatch and read by the other, each binds the stand-in where it
 *  does not use it (`writing` binds it written). */
export function volumeGroup(
  c: VolumeGroupInputs,
  volumeBuffer: GPUBuffer,
  viewBuffer: GPUBuffer,
  images: readonly [GPUTexture, GPUTexture],
  writing: boolean,
  beer: BeerBind,
  /** The cache the pass writes in place of the volume's (the occlusion's or the mask's texture), the texture a pass of the mask reads
   *  in place of the cache, the occlusion the march reads and the existence mask the cache and the occlusion read; the stand-in where none. */
  textures: Textures = {},
) {
  const { rt, held, cache, device, fogRead } = c
  const view = { baseMipLevel: 0, mipLevelCount: 1 }
  return device.createBindGroup({
    label: 'Trillion3D heterogeneous volume',
    layout: c.program.layout,
    entries: [
      ...sceneEntries(c),
      { binding: HV_BINDING.volume, resource: { buffer: volumeBuffer } },
      { binding: HV_BINDING.view, resource: { buffer: viewBuffer } },
      { binding: HV_BINDING.depth, resource: rt.gpu.depthView! },
      {
        binding: HV_BINDING.cacheOut,
        resource: (writing ? (textures.cache ?? cache) : held.standOut!).createView(view),
      },
      {
        binding: HV_BINDING.cacheIn,
        resource: (writing ? (textures.read ?? held.stand!) : cache).createView(view),
      },
      { binding: HV_BINDING.sampler, resource: held.sampler! },
      { binding: HV_BINDING.imageIn, resource: images[0].createView() },
      { binding: HV_BINDING.imageOut, resource: images[1].createView() },
      ...graphEntries(c),
      ...sideEntries(c, beer, textures),
      ...fogReadBindEntries(HV_FOG_BINDINGS, fogRead),
      ...variantEntries(c, textures),
    ],
  })
}
