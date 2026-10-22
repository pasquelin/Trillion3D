import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { askedComputeStage } from '../../gpu/core/computeStages.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { FRAME_FLOATS } from './frame.ts'
import { MULTISCATTERING_LUT, SKY_VIEW_LUT, TRANSMITTANCE_LUT } from './layout.ts'
import { AIR_BINDING, airLayoutEntries } from './programs.ts'
import { AIR_PROGRAMS, AIR_SHADERS, type AirProgramName } from './shaders.ts'
import { CAPTURE_FLOATS } from './captureWgsl.ts'

/** The sky as the light buffer's sky lights read it: nine harmonic coefficients of its radiance
 *  and how many captures have landed. */
export interface SkyCapture {
  revision: number
  coefficients: Float32Array
}

/** The sky is composited over the lit image: premultiplied, an alpha of one where it draws. */
const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }

/** The tables the air's passes build, each a storage texture of half floats with its view, and the
 *  sampler they are read through. */
function createAirTables(device: GPUDevice) {
  const texture = (label: string, width: number, height: number) => {
    const made = device.createTexture({
      label,
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    return { made, view: made.createView() }
  }
  const tables = {
    transmittance: texture(
      'Trillion3D air transmittance',
      TRANSMITTANCE_LUT.width,
      TRANSMITTANCE_LUT.height,
    ),
    multiScatter: texture(
      'Trillion3D air multiple scattering',
      MULTISCATTERING_LUT.width,
      MULTISCATTERING_LUT.height,
    ),
    skyView: texture('Trillion3D air sky', SKY_VIEW_LUT.width, SKY_VIEW_LUT.height),
  }
  const sampler = device.createSampler({
    label: 'Trillion3D air tables',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  return { tables, sampler }
}

/** The sky's capture: the buffer its pass writes, the ring that reads it back a few frames later,
 *  and the harmonics the last read left. */
function createSkyCaptureStore(device: GPUDevice) {
  const captureBuffer = device.createBuffer({
    label: 'Trillion3D sky capture',
    size: CAPTURE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  let revision = 0
  const captured: SkyCapture = { revision: 0, coefficients: new Float32Array(27) }
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D sky capture read', bytes: CAPTURE_FLOATS * 4, count: 2 },
    (mapped) => {
      captured.coefficients.set(new Float32Array(mapped, 0, 27))
      captured.revision = ++revision
    },
  )
  return { captureBuffer, ring, captured }
}

/** The programs: each compute pass's layout and its pipeline, asked now, off the frame, then the
 *  sky's draw the same. */
function createAirPasses(device: GPUDevice, failed: (error: unknown) => void) {
  /** A compute program: its layout, and its entry's pipeline asked now, off the frame. */
  const compute = (name: AirProgramName, entry: string, label: string) => {
    const layout = device.createBindGroupLayout({
      entries: airLayoutEntries(AIR_PROGRAMS[name].bindings, GPUShaderStage.COMPUTE),
    })
    const pipeline = askedComputeStage(device, [layout], AIR_SHADERS[name], entry, label, failed)
    return { layout, pipeline }
  }
  const passes = {
    transmittance: compute('transmittance', 'transmittanceMain', 'Trillion3D air transmittance'),
    multiScatter: compute('multiScatter', 'multiScatterMain', 'Trillion3D air multiple scattering'),
    skyView: compute('skyView', 'skyViewMain', 'Trillion3D air sky table'),
    haze: compute('haze', 'hazeMain', 'Trillion3D air haze'),
    distantSky: compute('distantSky', 'distantSkyMain', 'Trillion3D air distant sky'),
    capture: compute('skyCapture', 'skyCaptureMain', 'Trillion3D sky capture'),
    skyRays: compute('skyRays', 'skyRaysMain', 'Trillion3D sky by direction'),
  }
  const skyLayout = device.createBindGroupLayout({
    entries: airLayoutEntries(AIR_PROGRAMS.sky.bindings, GPUShaderStage.FRAGMENT),
  })
  const skyModule = device.createShaderModule({ label: 'Trillion3D sky', code: AIR_SHADERS.sky })
  const skyPipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      skyModule,
      skyLayout,
      'skyMain',
      [{ format: HDR_FORMAT, blend: { color: OVER, alpha: OVER } }],
      'Trillion3D sky',
    ),
  ).ask()
  skyPipeline.prepare().catch(failed)
  return { passes, skyLayout, skyPipeline }
}

/**
 * WHAT THE ATMOSPHERE'S PASSES ARE MADE OF, made once (`createAtmosphereGpu`): the tables and their
 * sampler, the image's frame and the capture's buffers, the capture's read-back ring, and the
 * programs — each compute pass's layout and its pipeline, asked now, off the frame, the sky's draw
 * the same —, and the one way a group of them is made over a light buffer.
 */
export function createAirResources(device: GPUDevice, failed: (error: unknown) => void) {
  const { tables, sampler } = createAirTables(device)
  const { captureBuffer, ring, captured } = createSkyCaptureStore(device)
  const frameBuffer = device.createBuffer({
    label: 'Trillion3D air frame',
    size: FRAME_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { passes, skyLayout, skyPipeline } = createAirPasses(device, failed)
  const group = (
    layout: GPUBindGroupLayout,
    resources: Partial<Record<keyof typeof AIR_BINDING, GPUBindingResource>>,
  ) => device.createBindGroup({ layout, entries: namedEntries(AIR_BINDING, resources) })
  return {
    tables,
    sampler,
    frameBuffer,
    captureBuffer,
    ring,
    captured,
    passes,
    skyLayout,
    skyPipeline,
    group,
    dispose() {
      ring.destroy()
      for (const { made } of Object.values(tables)) made.destroy()
      frameBuffer.destroy()
      captureBuffer.destroy()
    },
  }
}

/** What `createAirResources` made. */
export type AirResources = ReturnType<typeof createAirResources>
