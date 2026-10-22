import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { askedComputeStage } from '../../gpu/core/computeStages.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { AirBindingName } from './binding.ts'
import { FRAME_FLOATS } from './frame.ts'
import { cloudShadowStandIn } from './cloudShadowStandIn.ts'
import { airBindEntries, airLayoutEntries, type AirProgram } from './programs.ts'
import { volumesBytes } from './separatedWgsl.ts'
import { AIR_PROGRAM_MAKERS, type AirProgramName } from './shaders.ts'
import type { AirShape } from './shape.ts'

/** The sky is composited over the lit image: premultiplied, an alpha of one where it draws. */
const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }

/** The tables the air's passes build, each a storage texture with its view, and the sampler they
 *  are read through. The transmittance table is four bytes a texel where the shape asks for the
 *  small format; the others four half floats. */
function createAirTables(device: GPUDevice, shape: AirShape) {
  const texture = (label: string, width: number, height: number, format: GPUTextureFormat) => {
    const made = device.createTexture({
      label,
      size: { width, height },
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    return { made, view: made.createView() }
  }
  const { transmittance, multiScatter, skyView } = shape
  const tables = {
    transmittance: texture(
      'Trillion3D air transmittance',
      transmittance.width,
      transmittance.height,
      transmittance.small ? 'rgba8unorm' : 'rgba16float',
    ),
    multiScatter: texture(
      'Trillion3D air multiple scattering',
      multiScatter.width,
      multiScatter.height,
      'rgba16float',
    ),
    skyView: texture('Trillion3D air sky', skyView.width, skyView.height, 'rgba16float'),
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

/** A compute pass of the air: the program it runs, its layout and its pipeline. */
export interface AirPass {
  readonly program: AirProgram
  readonly layout: GPUBindGroupLayout
  readonly pipeline: ReturnType<typeof askedComputeStage>
}

/** The compute passes, each made when first asked: its layout, and its entry's pipeline asked
 *  then, off the frame. */
function createAirPasses(device: GPUDevice, shape: AirShape, failed: (error: unknown) => void) {
  const made = new Map<AirProgramName, AirPass>()
  const entries: Record<string, [string, string]> = {
    transmittance: ['transmittanceMain', 'Trillion3D air transmittance'],
    multiScatter: ['multiScatterMain', 'Trillion3D air multiple scattering'],
    publish: ['publishMain', 'Trillion3D air transmittance copy'],
    skyView: ['skyViewMain', 'Trillion3D air sky table'],
    haze: ['hazeMain', 'Trillion3D air haze'],
    hazeSeparate: ['hazeMain', 'Trillion3D air haze apart'],
    capture360: ['capture360Main', 'Trillion3D air capture haze'],
    distantSky: ['distantSkyMain', 'Trillion3D air distant sky'],
    skyRays: ['skyRaysMain', 'Trillion3D sky by direction'],
  }
  return (name: Exclude<AirProgramName, 'sky'>) => {
    let pass = made.get(name)
    if (!pass) {
      const program = AIR_PROGRAM_MAKERS[name](shape)
      const layout = device.createBindGroupLayout({
        entries: airLayoutEntries(program.bindings, GPUShaderStage.COMPUTE, shape),
      })
      const [entry, label] = entries[name]
      pass = {
        program,
        layout,
        pipeline: askedComputeStage(device, [layout], program.code, entry, label, failed),
      }
      made.set(name, pass)
    }
    return pass
  }
}

/** The sky's draw: its layout and its pipeline, asked now, off the frame. */
function createSkyPipeline(device: GPUDevice, shape: AirShape, failed: (error: unknown) => void) {
  const program = AIR_PROGRAM_MAKERS.sky(shape)
  const skyLayout = device.createBindGroupLayout({
    entries: airLayoutEntries(program.bindings, GPUShaderStage.FRAGMENT, shape),
  })
  const skyModule = device.createShaderModule({ label: 'Trillion3D sky', code: program.code })
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
  return { skyProgram: program, skyLayout, skyPipeline }
}

/** The bind group of `layout` for `program`: the resources it binds under `shape`, each at its
 *  binding (a resource the program does not bind is left out). */
const groupMaker =
  (device: GPUDevice, shape: AirShape) =>
  (
    program: AirProgram,
    layout: GPUBindGroupLayout,
    resources: Partial<Record<AirBindingName, GPUBindingResource>>,
  ) =>
    device.createBindGroup({
      layout,
      entries: airBindEntries(program.bindings, shape, resources),
    })

/** The buffer of the volumes the clouds read besides the haze: three regions of the main volume's
 *  cells, made when first asked. */
function lazyVolumes(device: GPUDevice, { aerial }: AirShape) {
  let volumes: GPUBuffer | undefined
  return () =>
    (volumes ??= device.createBuffer({
      label: 'Trillion3D air volumes',
      size: volumesBytes(aerial.width * aerial.width * aerial.slices, aerial.full),
      usage: GPUBufferUsage.STORAGE,
    }))
}

/**
 * WHAT THE ATMOSPHERE'S PASSES ARE MADE OF, made once for a shape (`createAtmosphereGpu`): the
 * tables and their sampler, the image's frame, and the programs — each compute pass's layout and its pipeline, asked when first wanted,
 * the sky's draw asked now —, and the one way a group of them is made over a light buffer.
 * The volumes the clouds read (the haze's light and the air's apart, the haze around a capture) are
 * made when first asked for.
 */
export function createAirResources(
  device: GPUDevice,
  shape: AirShape,
  failed: (error: unknown) => void,
) {
  const { tables, sampler } = createAirTables(device, shape)
  const frameBuffer = device.createBuffer({
    label: 'Trillion3D air frame',
    size: FRAME_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const pass = createAirPasses(device, shape, failed)
  const volumes = lazyVolumes(device, shape)
  // The passes the shape makes at once: the transmittance table's is none where it makes no table.
  const asked = [
    ...(shape.transmittance.on ? [pass('transmittance')] : []),
    ...(['multiScatter', 'publish', 'skyView', 'haze', 'distantSky', 'skyRays'] as const).map(pass),
  ]
  let volumesMade: GPUBuffer | undefined
  return {
    shape,
    tables,
    sampler,
    frameBuffer,
    pass,
    asked,
    cloudShadowNone: cloudShadowStandIn(device),
    ...createSkyPipeline(device, shape, failed),
    group: groupMaker(device, shape),
    /** The volumes the clouds read besides the haze, one buffer of three regions, made when first
     *  asked. */
    get volumes() {
      return (volumesMade = volumes())
    },
    dispose() {
      for (const { made } of Object.values(tables)) made.destroy()
      frameBuffer.destroy()
      volumesMade?.destroy()
    },
  }
}

/** What `createAirResources` made. */
export type AirResources = ReturnType<typeof createAirResources>
