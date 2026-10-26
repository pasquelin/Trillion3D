import { createAirEncoder } from './encode.ts'
import { createAirResources, type AirResources } from './resources.ts'
import { createOpaqueHazeDraw } from './opaqueHaze.ts'
import { createSkyDraw } from './sky.ts'
import type { AirShape } from './shape.ts'

/**
 * THE ATMOSPHERE'S GPU WORK, made once a scene declares an atmosphere and kept while it does:
 * the tables, the passes that build them and the sky's draw.
 *
 * What changes when decides what runs (`createAirEncoder`). Its pipelines compile off the frame
 * (`ask`): the frames wait for them, and none draws a sky before all are ready.
 */
export function createAtmosphereGpu(
  device: GPUDevice,
  shape: AirShape,
  failed: (error: unknown) => void,
) {
  const resources = createAirResources(device, shape, failed)
  const { asked, skyPipeline } = resources
  const work = createAirEncoder(device, resources)
  const draw = createSkyDraw(resources, () => work.groups)
  const opaque = createOpaqueHazeDraw(device, resources, () => work.groups, failed)
  /** Every pipeline the air asks, listed once: the sky's draw, then each compute pass. */
  const stages = [skyPipeline, ...asked.map((pass) => pass.pipeline)]

  return {
    /** Whether every pipeline is compiled: until then the image draws no air. */
    get ready() {
      for (const stage of stages) if (!stage.ready) return false
      if (opaque && !opaque.ready) return false
      return true
    },
    /** Whether the haze apart and the capture's volume the clouds ask are compiled, each asked now
     *  when it is wanted and not yet: the frames wait for them, so no image builds the plain haze
     *  in place of the one apart. */
    variantsReady(requests: { separate: boolean; capture360: boolean }) {
      let ready = true
      if (requests.separate) ready = resources.pass('hazeSeparate').pipeline.ready && ready
      if (requests.capture360) ready = resources.pass('capture360').pipeline.ready && ready
      return ready
    },
    /** The tables and the volume of this image, built on `encoder`: the air's tables when the air
     *  changed, the sky around the eye and the haze every image — and the copy of the harmonics,
     *  read back once the image is submitted. */
    encode: work.encode,
    /** The sky over the lit image where no surface was drawn, `width × height` pixels of `hdr`, its
     *  march jittered by `noise` where it is marched. */
    drawSky: draw,
    /** The haze marched on the opaque surfaces over the lit image, where the shape asks for it
     *  (`aerialFastOnOpaque` off); none otherwise (`createOpaqueHazeDraw`). */
    drawOpaqueHaze: opaque?.draw,
    /** The shape the passes were made for. */
    shape,
    /** The buffer of the image's frame (`writeAirFrame`), written by `encode`: what the cloud
     *  shadow maps' trace reads of the camera. */
    get frameBuffer() {
      return resources.frameBuffer
    },
    /** The volume of the haze, a 3D texture the haze pass wrote this image: what the fog pass samples
     *  (`hazeSampledWgsl`). */
    get hazeVolume() {
      return resources.hazeVolume
    },
    /** The tables the sky light's capture reads, with the sampler they are read through. */
    get tables() {
      return tablesOf(resources)
    },
    /** The buffer of the volumes the clouds read besides the haze — the haze's light alone, the air's
     *  alone, the haze around the capture's place —, made when first read; their cells are the
     *  main volume's (`AirShape.aerial`). */
    get volumes() {
      return resources.volumes
    },
    dispose() {
      resources.dispose()
    },
  }
}

/** The tables the sky light's capture reads, with the sampler they are read through. */
function tablesOf({ tables, sampler }: AirResources) {
  return {
    transmittance: tables.transmittance.view,
    multiScatter: tables.multiScatter.view,
    sampler,
  }
}

/** The atmosphere's GPU work (`createAtmosphereGpu`). */
export type AtmosphereGpu = ReturnType<typeof createAtmosphereGpu>
