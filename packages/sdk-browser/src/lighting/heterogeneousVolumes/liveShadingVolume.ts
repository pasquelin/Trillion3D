import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { type BeerBind, encodeBeerBuild } from './beerShadowMapGpu.ts'
import { ambientOcclusionOf } from './liveShadingAmbient.ts'
import { existenceMaskOf } from './liveShadingExistence.ts'
import { type FrameContext, frameView } from './liveShadingContext.ts'
import { volumeWords } from './liveShadingGpu.ts'
import { HV_VOLUME_BYTES } from './liveShadingPack.ts'
import { volumeGroup } from './liveShadingGroup.ts'
import { volumeResourcesOf } from './liveShadingResources.ts'
import { bufferOf, type placementOf } from './liveShadingState.ts'
import { HV_VIEW_BYTES, packView } from './liveShadingView.ts'

type Placed = ReturnType<typeof placementOf>
type Resources = NonNullable<ReturnType<typeof volumeResourcesOf>>
type Textures = {
  cache?: GPUTexture
  read?: GPUTexture
  ambient?: GPUTexture
  existence?: GPUTexture
}

/** Writes the view's uniform of a pass into `buffer`: the camera's numbers, the exposure, the clocks, the switches and `words`. */
function writeViewBuffer(
  c: FrameContext,
  buffer: GPUBuffer,
  firstVolume: boolean,
  words: ArrayLike<number>,
) {
  const size = c.rt.gpu.targetSize
  c.device.queue.writeBuffer(
    buffer,
    0,
    packView(
      {
        inverseViewProj: frameView.inverse,
        eye: c.cam.eye,
        forward: frameView.forward,
        depthMap: frameView.depthMap,
        perspective: c.cam.perspective === 1,
        viewProj: c.cam.viewProjection,
        giGrid: c.gi?.grid,
        giZ: c.gi?.z,
      },
      [0, 0, size[0], size[1]],
      [c.pre.now, c.pre.exposure],
      [c.clocks.time, c.clocks.realTime],
      [firstVolume ? 1 : 0, c.factor, noiseFrame(c.rt), c.velocity ? 1 : 0],
      words,
    ),
  )
  return buffer
}

/**
 * The uniforms of the passes of one volume: its words (`packed`) and buffers, and the view's. `state.occlusionRead` is set once the occlusion is
 * computed, the passes that compute it read none.
 */
function volumeUniforms(c: FrameContext, item: Placed, resources: Resources, holds: boolean) {
  const { rt, device, held, settings } = c
  const { volume, entry, toWorld, toLocal, centre, extent } = item
  const { cacheSize } = resources
  const state = { occlusionRead: false }
  const packed = (light: number, last: boolean, build: boolean, existence = false) =>
    volumeWords(
      {
        settings,
        volume,
        toWorld,
        toLocal,
        centre,
        extent,
        entry,
        cacheSize,
        mode: settings('heterogeneousVolumesLightingCache'),
        fogMode: c.fogMode,
        indirectMode: c.indirectMode,
        ambientOcclusion: state.occlusionRead,
        holdout: holds,
        existence,
        cameraMap: !!c.cameraMaps,
      },
      light,
      last,
      build,
    )
  const volumeBufferOf = (name: string, words: ArrayBuffer) => {
    const buffer = bufferOf(
      held,
      device,
      `${volume.id} ${name}`,
      HV_VOLUME_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    device.queue.writeBuffer(buffer, 0, words)
    return buffer
  }
  const viewBufferOf = (
    name: string,
    firstVolume: boolean,
    words: ArrayLike<number> = [0, 0, 0, 0, 0, 0, 0, 0],
  ) =>
    writeViewBuffer(
      c,
      bufferOf(
        held,
        device,
        `${volume.id} ${name}`,
        HV_VIEW_BYTES,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      ),
      firstVolume,
      words,
    )
  return { state, packed, volumeBufferOf, viewBufferOf }
}

/** What the passes of one volume bind: its uniforms (`volumeUniforms`) and the bind group of a pass over the two images. */
function volumeBinds(c: FrameContext, item: Placed, resources: Resources, holds: boolean) {
  const { rt, device, held, target, shadow } = c
  const { state, packed, volumeBufferOf, viewBufferOf } = volumeUniforms(c, item, resources, holds)
  const groupInputs = {
    device,
    rt,
    held,
    program: resources.program,
    vsm: c.vsm,
    slotsBuffer: resources.slotsBuffer,
    valuesBuffer: resources.valuesBuffer,
    cache: resources.cache,
    slotsGpu: resources.slotsGpu,
    giView: c.giView,
    atlas: resources.atlas,
    velocity: c.velocity,
    taaStand: c.taaStand,
    fogRead: c.fogRead,
    holdout: c.holdoutTarget,
  }
  const groupFor = (
    volumeBuffer: GPUBuffer,
    viewBuffer: GPUBuffer,
    images: readonly [GPUTexture, GPUTexture],
    writing: boolean,
    beer: BeerBind,
    textures?: Textures,
  ) => volumeGroup(groupInputs, volumeBuffer, viewBuffer, images, writing, beer, textures)
  /** The bind group of a pass that fills a texture of the volume's own (the mask, the occlusion) with the view's words `words`. */
  const filling = (
    role: string,
    words: ArrayLike<number> | undefined,
    textures: Textures,
    existence = false,
  ) =>
    groupFor(
      volumeBufferOf(`${role} volume`, packed(0, true, false, existence)),
      viewBufferOf(`${role} view`, false, words),
      target.images,
      true,
      shadow.stand,
      textures,
    )
  return { state, packed, volumeBufferOf, viewBufferOf, groupFor, filling }
}

type Binds = ReturnType<typeof volumeBinds>

/** The volume's rays through every light's map, combined with those of the volumes before it. The cache is not used. */
function encodeShadowBuild(c: FrameContext, binds: Binds, resources: Resources) {
  const { shadow, target } = c
  if (!resources.program.beer) return
  encodeBeerBuild({
    encoder: c.encoder,
    pipeline: resources.program.beer,
    lights: shadow.lights,
    resolution: shadow.resolution,
    built: shadow.built,
    uniformOf: shadow.uniformOf,
    imageOf: shadow.imageOf,
    bindFor: (beer) =>
      binds.groupFor(
        binds.volumeBufferOf('shadow volume', binds.packed(0, true, true)),
        binds.viewBufferOf('shadow view', false),
        target.images,
        true,
        beer,
      ),
  })
}

/** The existence mask of the grid of `size` voxels (dilated), where the setting asks for it. */
function maskOf(
  c: FrameContext,
  item: Placed,
  resources: Resources,
  binds: Binds,
  size: readonly [number, number, number],
  role: string,
) {
  const { program } = resources
  return existenceMaskOf({
    held: c.held,
    device: c.device,
    encoder: c.encoder,
    existence: program.existence,
    dilate: program.dilate,
    size,
    key: `${item.volume.id}:${role}`,
    rawGroup: (raw) => binds.filling(`${role} mask`, undefined, { cache: raw }),
    dilateGroup: (raw, dilated) =>
      binds.filling(`${role} mask`, undefined, { cache: dilated, read: raw }),
  })
}

/**
 * The passes of the volume over the two images: for each light of the transmittance cache (mode 1, one light at a time; the emission and the
 * transmittance applied by the last) or once for all, the cache's fill and the march of every pixel's ray. The march also writes the camera's beer map.
 */
function encodeMarch(
  c: FrameContext,
  binds: Binds,
  resources: Resources,
  holds: boolean,
  ambient: GPUTexture | undefined,
  cacheMask: GPUTexture | undefined,
) {
  const { rt, encoder, target, shadow, cameraMaps, scaled } = c
  const { cacheSize } = resources
  const mode = c.settings('heterogeneousVolumesLightingCache')
  const lightCount = mode === 1 ? Math.max(rt.lights.store.count, 1) : 1
  for (let light = 0; light < lightCount; light++) {
    const last = light === lightCount - 1
    const volumeBuffer = binds.volumeBufferOf(
      `volume ${light}`,
      binds.packed(light, last, false, !!cacheMask),
    )
    const viewBuffer = binds.viewBufferOf(`view ${light}`, c.first)
    const images = c.ping === 0 ? target.images : ([target.images[1], target.images[0]] as const)
    const pass = encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume' })
    // Mode 0 reads the lights at each step: it has no cache to fill; a volume that holds out renders no cache (`bRenderLightingCache`).
    if (mode !== 0 && !holds) {
      pass.setPipeline(resources.cachePipeline)
      pass.setBindGroup(
        0,
        binds.groupFor(volumeBuffer, viewBuffer, images, true, shadow.stand, {
          ambient,
          existence: cacheMask,
        }),
      )
      pass.dispatchWorkgroups(
        Math.ceil(cacheSize[0] / 4),
        Math.ceil(cacheSize[1] / 4),
        Math.ceil(cacheSize[2] / 4),
      )
    }
    pass.setPipeline(resources.marchPipeline)
    const beer: BeerBind = cameraMaps
      ? {
          uniform: shadow.stand.uniform,
          previous: cameraMaps[c.ping].createView(),
          out: cameraMaps[1 - c.ping].createView(),
        }
      : shadow.stand
    pass.setBindGroup(0, binds.groupFor(volumeBuffer, viewBuffer, images, false, beer, { ambient }))
    pass.dispatchWorkgroups(Math.ceil(scaled[0] / 8), Math.ceil(scaled[1] / 8))
    pass.end()
    c.first = false
    c.ping = 1 - c.ping
  }
}

/** Encodes one volume of the image: the build of its part of the lights' shadow maps in the `shadows` phase, else its occlusion, its cache's mask and its passes. */
export function encodeVolume(c: FrameContext, item: Placed) {
  const { rt, device, held, sparse, settings } = c
  const resources = volumeResourcesOf({
    held,
    rt,
    device,
    sparse,
    placed: item,
    settings,
    beerFormat: c.beerFormat,
    holdout: !!c.holdoutTarget,
  })
  if (!resources) return
  // Whether the volume leaves its opacity in the holdout, where there is one (the reference: IsHoldout).
  const holds = !!c.holdoutTarget && item.volume.holdout
  const binds = volumeBinds(c, item, resources, holds)
  if (c.shadowed) return encodeShadowBuild(c, binds, resources)
  // The volume's occlusion, computed before the pass reads it where the settings ask for it.
  const ambient = ambientOcclusionOf({
    held,
    device,
    encoder: c.encoder,
    pipeline: resources.aoPipeline,
    resolution: item.entry.resolution,
    id: item.volume.id,
    holdout: holds,
    settings,
    indirectMode: c.indirectMode,
    existenceOf: (size) =>
      c.useExistence ? maskOf(c, item, resources, binds, size, 'occlusion') : undefined,
    groupOf: (words, texture, mask) =>
      binds.filling('occlusion', words, { cache: texture, existence: mask }, !!mask),
  })
  binds.state.occlusionRead = !!ambient
  // The cache's existence mask (the cinematic scalability alone, `LiveShadingPipeline.usf:433`): the voxels away from any extinction keep their empty value.
  const mode = settings('heterogeneousVolumesLightingCache')
  const cacheMask =
    c.useExistence && c.scalability === 3 && mode !== 0 && !holds
      ? maskOf(c, item, resources, binds, resources.cacheSize, 'cache')
      : undefined
  encodeMarch(c, binds, resources, holds, ambient, cacheMask)
}
