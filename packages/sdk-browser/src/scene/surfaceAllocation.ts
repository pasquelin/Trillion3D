import { SUBSURFACE_TARGET } from './subsurface.ts'
import { PHYSICAL_LOBES_FORMAT, PHYSICAL_LOBES_TARGET } from './physicalLobes.ts'
import { EMISSIVE_AO_BYTES } from './surfaceEmission.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import { RECEIVER_TARGET_FORMAT } from '../visibility/shader/receiverTargetWgsl.ts'
import {
  SURFACE_FORMATS,
  checkSurfaceSize,
  emissiveAoBytes,
  holds,
  type SurfaceBuffer,
} from './surfaceBuffer.ts'

/** A target copied out and in: the captures' (`../webgpu/pages/io/surfaceCapture.ts`). */
const copies = () => GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
/** A surface target of the buffer: `format` at `size`. */
const surfaceTarget = (device: GPUDevice, format: GPUTextureFormat, size: GPUExtent3DStrict) =>
  device.createTexture({
    label: `Trillion3D surface v1 ${format}`,
    size,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | copies(),
  })

/** The targets of the buffer read by load alone (`../gpu/core/loadOnlyTarget.ts`): full-size when
 *  wanted, a 1×1 otherwise — the shadow receiver always full-size —, each with its usage. */
const OPTIONAL_TARGETS = {
  subsurface: ['thin transmission', 'rgba16float', () => loadOnlyUsage() | copies()],
  receiver: ['shadow receiver', RECEIVER_TARGET_FORMAT, loadOnlyUsage],
  // Written as a colour too, by the water's lobed surface stage (`../webgpu/water/lobedStage.ts`).
  lobes: [
    'physical lobes',
    PHYSICAL_LOBES_FORMAT,
    () => loadOnlyUsage() | GPUTextureUsage.RENDER_ATTACHMENT,
  ],
} satisfies Record<string, [string, GPUTextureFormat, () => number]>
type OptionalTarget = keyof typeof OPTIONAL_TARGETS

/** Optional target `name` of a `width` × `height` buffer, full-size when `wanted`. */
const optionalTarget = (
  device: GPUDevice,
  name: OptionalTarget,
  width: number,
  height: number,
  wanted: boolean,
) => {
  const [label, format, usage] = OPTIONAL_TARGETS[name]
  return device.createTexture({
    label: `Trillion3D ${label}`,
    format,
    usage: usage(),
    size: wanted ? [width, height] : [1, 1],
  })
}

/** What the buffer holds full-size besides its targets (`createSurfaceBuffer`). */
export type SurfaceOptions = { subsurface?: boolean; emissiveAo?: boolean; lobes?: boolean }

/** The surface buffer of a `width` × `height` frame. Without `emissiveAo`, the third target is a
 *  1×1 `(0, 0, 0, 1)`: no texel is marked (`surfaceEmitsOrOccludes`), its readers load under the
 *  mark alone (`surfaceEmissiveAo`), its passes leave the slot empty. Without `subsurface` or
 *  `lobes`, their targets are 1×1 (`OPTIONAL_TARGETS`). */
export function createSurfaceBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  { subsurface = false, emissiveAo = true, lobes = false }: SurfaceOptions = {},
): SurfaceBuffer {
  const allocationBytes =
    checkSurfaceSize(device, width, height) +
    SUBSURFACE_TARGET.bytes(width, height, subsurface) +
    PHYSICAL_LOBES_TARGET.bytes(width, height, lobes) -
    emissiveAoBytes(width, height, true) +
    emissiveAoBytes(width, height, emissiveAo)
  const textures: GPUTexture[] = []
  const optional: Partial<Record<OptionalTarget, GPUTexture>> = {}
  try {
    SURFACE_FORMATS.forEach((format, at) => {
      const layer = at !== 2 || emissiveAo
      textures.push(surfaceTarget(device, format, layer ? { width, height } : [1, 1]))
      if (!layer)
        device.queue.writeTexture(
          { texture: textures[at] },
          Uint16Array.of(0, 0, 0, HALF_ONE),
          { bytesPerRow: EMISSIVE_AO_BYTES },
          [1, 1],
        )
    })
    const wanted = { subsurface, receiver: true, lobes }
    for (const name of Object.keys(OPTIONAL_TARGETS) as OptionalTarget[])
      optional[name] = optionalTarget(device, name, width, height, wanted[name])
  } catch (error) {
    for (const texture of [...textures, ...Object.values(optional)]) texture.destroy()
    throw error
  }
  return assemble({
    width,
    height,
    allocationBytes,
    textures,
    ...(optional as Record<OptionalTarget, GPUTexture>),
    hasEmissiveAo: emissiveAo,
  })
}

/** `(0, 0, 0, 1)`'s last channel in half float. */
const HALF_ONE = 0x3c00

type SurfaceParts = Pick<SurfaceBuffer, 'width' | 'height' | 'allocationBytes' | 'hasEmissiveAo'> &
  Record<OptionalTarget, GPUTexture> & {
    textures: GPUTexture[]
    /** Textures the buffer frees with its own though none of its members names them. */
    retired?: GPUTexture[]
  }

/** Each record's retired textures, which a record made from it frees too (`partsOf`). */
const retiredOf = new WeakMap<SurfaceBuffer, GPUTexture[]>()

function assemble(parts: SurfaceParts): SurfaceBuffer {
  const { textures, subsurface, receiver, lobes, retired = [] } = parts
  const views = textures.map((texture) => texture.createView())
  let disposed = false
  const record: SurfaceBuffer = {
    version: 1,
    width: parts.width,
    height: parts.height,
    allocationBytes: parts.allocationBytes,
    baseMetal: textures[0],
    normalRough: textures[1],
    emissiveAo: textures[2],
    flags: textures[3],
    subsurface,
    subsurfaceView: subsurface.createView(),
    receiver,
    receiverView: receiver.createView(),
    lobes,
    lobesView: lobes.createView(),
    hasEmissiveAo: parts.hasEmissiveAo,
    views: () => {
      if (disposed) throw new Error('SURFACE_DISPOSED')
      return views
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const texture of [...textures, ...retired, subsurface, receiver, lobes])
        texture.destroy()
    },
  }
  retiredOf.set(record, retired)
  return record
}

/** The parts of `surfaces`, to make a record of the same targets with one replaced. */
const partsOf = (surfaces: SurfaceBuffer): SurfaceParts => ({
  ...surfaces,
  textures: [surfaces.baseMetal, surfaces.normalRough, surfaces.emissiveAo, surfaces.flags],
  retired: retiredOf.get(surfaces),
})

/**
 * The same buffer with its emission-and-occlusion layer made, for an image whose surface came to
 * emit or occlude: a new record — its views, which every reader binds by, are new — on the same
 * targets, which it frees from now on, the stand-in too, which a pass already encoded may still
 * name. The record replaced is not disposed.
 */
export function withEmissiveAo(device: GPUDevice, surfaces: SurfaceBuffer): SurfaceBuffer {
  const { width, height } = surfaces
  const layer = surfaceTarget(device, SURFACE_FORMATS[2], { width, height })
  return assemble({
    ...partsOf(surfaces),
    allocationBytes:
      surfaces.allocationBytes -
      emissiveAoBytes(width, height, false) +
      emissiveAoBytes(width, height, true),
    textures: [surfaces.baseMetal, surfaces.normalRough, layer, surfaces.flags],
    hasEmissiveAo: true,
    retired: [...(retiredOf.get(surfaces) ?? []), surfaces.emissiveAo],
  })
}

/**
 * The same buffer with its lobes target remade, full-size when `wanted`, a 1×1 otherwise: a lobed
 * surface that comes or goes remakes that target alone, never the frame's others. A new record on
 * the same targets; the lobes target replaced is the caller's to free once no pass names it. Its
 * bytes are read off the size it has, whatever `wanted` asks.
 */
export function withLobes(device: GPUDevice, surfaces: SurfaceBuffer, wanted: boolean) {
  const { width, height } = surfaces
  return assemble({
    ...partsOf(surfaces),
    allocationBytes:
      surfaces.allocationBytes -
      PHYSICAL_LOBES_TARGET.bytes(width, height, holds(surfaces, surfaces.lobes)) +
      PHYSICAL_LOBES_TARGET.bytes(width, height, wanted),
    lobes: optionalTarget(device, 'lobes', width, height, wanted),
  })
}
