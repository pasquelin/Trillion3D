import { type EngineCamera } from '../../camera/engineCamera.ts'
import { type WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { publishHeterogeneousCamera } from './cameraMap.ts'
import { beginFrame, type FrameContext, frameView } from './liveShadingContext.ts'
import { composeVolumes } from './liveShadingCompose.ts'
import { HV_FORMAT } from './liveShadingProgram.ts'
import { builtShadowMaps } from './beerShadowMapGpu.ts'
import { packAdaptiveMaps, packShadowMaps } from './liveShadingShadows.ts'
import { encodeVolume } from './liveShadingVolume.ts'
import { publishHeterogeneousShadowBuffer } from './volumeShadowRead.ts'
import { encodeVoxelGridPhase } from './voxelGridFrame.ts'

/**
 * THE HETEROGENEOUS VOLUMES IN THE FRAME (`HeterogeneousVolumes.cpp:403-410`). The `shadows` phase builds the maps of the volumes' cast
 * shadows before the lights are applied; the `image` phase renders each volume, nearest first, into the volumes' image (the
 * lighting cache over its bounds, then the march of each pixel's ray), brings it back to the view's size and lays it over the lit
 * image (`liveShadingCompose.ts`). A scene with no volume, or whose settings turn them off, encodes no pass and holds no resource.
 * The defaults follow the reference's highest scalability (`LiveShadingPipeline.cpp:77`).
 */

/** The maps the `shadows` phase built, packed in the buffer the lit passes read (`volumeShadowRead.ts`). */
function finishShadows(c: FrameContext) {
  const { held, shadow, settings } = c
  if (shadow.adaptive) {
    packAdaptiveMaps(held, c.device, c.encoder, shadow, settings)
    publishHeterogeneousShadowBuffer(c.rt.gpu, held.packedMaps)
    return
  }
  held.maps = builtShadowMaps(
    shadow.lights,
    shadow.built,
    shadow.resolution,
    shadow.uniformOf,
    shadow.imageOf,
  )
  packShadowMaps(
    held,
    c.device,
    c.encoder,
    settings('heterogeneousVolumesShadowsPrecision'),
    shadow.jobOf,
  )
  publishHeterogeneousShadowBuffer(c.rt.gpu, held.packedMaps)
}

/** The camera's beer map and the volumes' radiance, stacked in the array the translucent layers read (the reference's half-float map is this precision). */
function publishCameraMap(c: FrameContext, maps: [GPUTexture, GPUTexture]) {
  const { held, device, encoder, scaled } = c
  if (!held.camera || held.camera.size[0] !== scaled[0] || held.camera.size[1] !== scaled[1]) {
    held.camera?.texture.destroy()
    const texture = device.createTexture({
      label: 'Trillion3D heterogeneous volume camera map',
      size: [scaled[0], scaled[1], 2],
      format: HV_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    held.camera = { texture, view: texture.createView({ dimension: '2d-array' }), size: scaled }
  }
  const extent = [scaled[0], scaled[1], 1] as const
  encoder.copyTextureToTexture({ texture: maps[c.ping] }, { texture: held.camera.texture }, extent)
  encoder.copyTextureToTexture(
    { texture: c.target.images[c.ping] },
    { texture: held.camera.texture, origin: [0, 0, 1] },
    extent,
  )
  publishHeterogeneousCamera(c.rt.gpu, { view: held.camera.view, factor: c.factor })
}

/**
 * Encodes the heterogeneous volumes of the scene, none where there is none. The `shadows` phase, before the lights are
 * applied, builds the maps of the volumes' shadows (`Shadows`, published by `volumeShadowRead.ts`); the `image` phase
 * lays the volumes over the lit image.
 */
export function encodeHeterogeneousVolumes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  phase: 'shadows' | 'image' = 'image',
) {
  const c = beginFrame(rt, device, encoder, cam, phase)
  if (!c) return
  // The voxel grids take the phase over while the shadows are made through them (the shadows phase) or a debug mode asks (the image phase).
  if (!encodeVoxelGridPhase(c)) for (const item of c.placed) encodeVolume(c, item)
  if (c.shadowed) return finishShadows(c)
  if (c.first) return
  if (c.cameraMaps) publishCameraMap(c, c.cameraMaps)
  composeVolumes({
    held: c.held,
    rt,
    device,
    encoder,
    target: c.target,
    ping: c.ping,
    factor: c.factor,
    scaled: c.scaled,
    settings: c.settings,
    ...frameView,
    eye: cam.eye,
    holdout: c.holdoutTarget,
    cameraMap: c.cameraMaps?.[c.ping],
    perspective: cam.perspective === 1,
  })
}
