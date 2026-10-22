import { createAirEncoder } from './encode.ts'
import { createAirResources, type SkyCapture } from './resources.ts'
import { createSkyDraw } from './sky.ts'

export type { SkyCapture }

/**
 * THE ATMOSPHERE'S GPU WORK, made once a scene declares an atmosphere and kept while it does:
 * the tables, the passes that build them, the sky's draw and the sky's capture.
 *
 * What changes when decides what runs (`createAirEncoder`). The sun or the air moving sums the sky
 * into the fog's colour and the sky light's harmonics, once; the harmonics are read back a few
 * frames later, asynchronously, and `skyCapture` hands them on. Its pipelines compile off the
 * frame (`ask`): the frames wait for them, and none draws a sky before all are ready.
 */
export function createAtmosphereGpu(device: GPUDevice, failed: (error: unknown) => void) {
  const resources = createAirResources(device, failed)
  const { ring, captured, passes, skyPipeline } = resources
  const work = createAirEncoder(device, resources)
  const draw = createSkyDraw(resources)
  /** Every pipeline the air asks, listed once: the sky's draw, then each compute pass. */
  const stages = [skyPipeline, ...Object.values(passes).map((pass) => pass.pipeline)]

  return {
    /** Whether every pipeline is compiled: until then the image draws no air. */
    get ready() {
      for (const stage of stages) if (!stage.ready) return false
      return true
    },
    /** The tables and the volume of this image, built on `encoder`: the air's tables when the air
     *  changed, the sky around the eye and the haze every image, the sky's sums when the sun or the
     *  air moved — and the copy of the harmonics, read back once the image is submitted. */
    encode: work.encode,
    /** The sky over the lit image where no surface was drawn, `width × height` pixels of `hdr`. */
    drawSky(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      flags: GPUTextureView,
      width: number,
      height: number,
    ) {
      draw(encoder, work.groups, hdr, flags, width, height)
    },
    /** How many times the sky by direction was built, counted as its pass is encoded: what the bounce
     *  probes compare, to see the sky again once it changed — or first came. */
    get skyBuilds() {
      return work.skyBuilds
    },
    /** The captured sky, once one has landed. */
    skyCapture(): SkyCapture | undefined {
      return captured.revision ? captured : undefined
    },
    /** The image was submitted: the copy of the harmonics maps. */
    submitted() {
      ring.submitted()
    },
    dispose() {
      resources.dispose()
    },
  }
}

/** The atmosphere's GPU work (`createAtmosphereGpu`). */
export type AtmosphereGpu = ReturnType<typeof createAtmosphereGpu>
