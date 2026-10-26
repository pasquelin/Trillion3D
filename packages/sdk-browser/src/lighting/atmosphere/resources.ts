import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { askedComputeStage } from '../../gpu/core/computeStages.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { AirBindingName } from './binding.ts'
import { FRAME_FLOATS } from './frame.ts'
import { cloudShadowStandIn } from './cloudShadowStandIn.ts'
import { airBindEntries, airLayoutEntries, type AirProgram } from './programs.ts'
import { volumesBytes } from './separatedWgsl.ts'
import { AIR_PROGRAM_MAKERS, type AirProgramName } from './shaders.ts'
import { HAZE_VOLUME_FORMAT, type AirShape } from './shape.ts'

/** The sky is composited over the lit image: premultiplied, an alpha of one where it draws. */
const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
/** The image's alpha, the share of the background left visible, is multiplied by what the sky lets through: nothing, where it draws. */
const ALPHA_THROUGH: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }
/** An atmosphere that holds its light out lays its coverage on the alpha instead, a hole in it. */
const ALPHA_HOLDOUT: GPUBlendComponent = OVER

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
  const sampler = postSamplers(device).clamped
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
  const pipelineOf = (alpha: GPUBlendComponent) => {
    const made = preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        skyModule,
        skyLayout,
        'skyMain',
        [{ format: HDR_FORMAT, blend: { color: OVER, alpha } }],
        'Trillion3D sky',
      ),
    ).ask()
    made.prepare().catch(failed)
    return made
  }
  const skyPipeline = pipelineOf(ALPHA_THROUGH)
  // The holdout's pipeline is made at the first image that holds the sky out.
  let holdout: ReturnType<typeof pipelineOf> | undefined
  return {
    skyProgram: program,
    skyLayout,
    skyPipeline,
    skyHoldoutPipeline: () => (holdout ??= pipelineOf(ALPHA_HOLDOUT)),
  }
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
  // The haze's volume as a 3D texture: what the haze pass writes beside the light buffer's region and
  // the fog pass samples (`HAZE_VOLUME_FORMAT`).
  const { aerial } = shape
  const hazeTexture = device.createTexture({
    label: 'Trillion3D air haze volume',
    dimension: '3d',
    size: { width: aerial.width, height: aerial.width, depthOrArrayLayers: aerial.slices },
    format: HAZE_VOLUME_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
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
    ...(['multiScatter', 'publish', 'skyView', 'haze', 'distantSky'] as const).map(pass),
  ]
  let volumesMade: GPUBuffer | undefined
  return {
    shape,
    tables,
    sampler,
    frameBuffer,
    pass,
    asked,
    /** The haze's volume, a 3D texture of `aerial.width` cells across and down and `aerial.slices` deep. */
    hazeVolume: hazeTexture.createView(),
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
      hazeTexture.destroy()
      frameBuffer.destroy()
      volumesMade?.destroy()
    },
  }
}

/** What `createAirResources` made. */
export type AirResources = ReturnType<typeof createAirResources>
