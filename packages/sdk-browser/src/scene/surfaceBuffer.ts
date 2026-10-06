import { SUBSURFACE_BYTES, subsurfaceBytes } from './subsurface.ts'
import { pyramidHeldBytes } from '../gpu/hiz/pyramid.ts'
import { EMISSIVE_AO_BYTES } from './surfaceEmission.ts'
import {
  RECEIVER_TARGET_BYTES,
  RECEIVER_TARGET_FORMAT,
} from '../visibility/shader/receiverTargetWgsl.ts'

/** Version 1: opaque/masked material properties in linear space, before lighting.
 * No velocity or GI representation is claimed by this contract. The flags hold a model of 0 to 5
 * and three marks (`SurfaceBuffer.flags`), written by the opaque resolve alone: eight bits keep
 * every one. */
export const SURFACE_FORMATS: GPUTextureFormat[] = [
  'rgba16float',
  'rgba16float',
  'rgba16float',
  'r8uint',
]
/** Bytes of the four surface targets per pixel, and the shadow receiver's the resolve writes for
 *  the virtual shadow maps' projection (`../visibility/shader/receiverTargetWgsl.ts`). */
export const SURFACE_BYTES_PER_PIXEL = 25 + RECEIVER_TARGET_BYTES
/** Display colour target, what the composition writes; before it, the water pass borrows it. */
export const DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in sixteen. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint'
/** Bytes per pixel of the feedback target, made only while the pipelines write it
 *  (`../webgpu/pages/prepare/feedbackVariant.ts`). */
export const FEEDBACK_BYTES = 4
/** Color, depth, visibility, HDR, material surfaces, the transparent texture feedback target and
 *  the optional Hi-Z pyramid. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE')
  // Colour, depth and visibility take 4 bytes each, HDR 8, the feedback 4.
  let bytes = width * height * (24 + SURFACE_BYTES_PER_PIXEL)
  if (withHiz) bytes += pyramidHeldBytes(width, height)
  return bytes + SUBSURFACE_BYTES
}
/** Per-pixel surface data of a frame, kept on the GPU: depth, normals, material. */
export interface SurfaceBuffer {
  /** Format version. */
  readonly version: 1
  /** Width in pixels. */
  readonly width: number
  /** Height in pixels. */
  readonly height: number
  /** GPU bytes it holds. */
  readonly allocationBytes: number
  /** RGB base color, A metalness. */
  readonly baseMetal: GPUTexture
  /** XYZ world normal, A roughness. */
  readonly normalRough: GPUTexture
  /** RGB emission, A ambient occlusion. */
  readonly emissiveAo: GPUTexture
  /** Low three bits: 0 background, 1 unlit (fogged), 2 reads, 3 shown as-is: a diagnostic, a normal
   *  or depth view; 4 and 5 the diffuse and toon models (`./surfaceModel.ts`). Above them, marks: 16
   *  an emission-and-occlusion texel other than (0, 0, 0, 1) (`./surfaceEmission.ts`), 32 a thin
   *  transmission, 128 no fog. */
  readonly flags: GPUTexture
  /** Independent thin-surface transmission color; a 1×1 zero texture when disabled. */
  readonly subsurface: GPUTexture
  /** View of the thin-surface transmission texture. */
  readonly subsurfaceView: GPUTextureView
  /** The shadow receiver of each pixel (`../visibility/shader/receiverTargetWgsl.ts`). */
  readonly receiver: GPUTexture
  /** The view of `receiver` the shading pass writes and the lighting reads. */
  readonly receiverView: GPUTextureView
  /** Whether thin-surface transmission has a full-size target. */
  readonly hasSubsurface: boolean
  /** Whether the emission-and-occlusion layer has its pixels; a 1×1 `(0, 0, 0, 1)` otherwise. */
  readonly hasEmissiveAo: boolean
  /** Its GPU texture views. */
  views(): GPUTextureView[]
  /** Frees it. */
  dispose(): void
}
/**
 * Bytes a surface of this size takes, once DEVICE limits are checked.
 * No byte ceiling is set here: targets follow resolution,
 * and only what the device declares it cannot do is refused, by name.
 */
export function checkSurfaceSize(
  device: GPUDevice,
  width: number,
  height: number,
  bytesPerPixel = SURFACE_BYTES_PER_PIXEL,
) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE')
  if (
    width > (device.limits.maxTextureDimension2D ?? 8192) ||
    height > (device.limits.maxTextureDimension2D ?? 8192)
  )
    throw new Error('SURFACE_DEVICE_LIMIT')
  const bytes = width * height * bytesPerPixel
  if (!Number.isSafeInteger(bytes)) throw new Error('INVALID_SURFACE_SIZE')
  return bytes
}
/** What the frame takes of the emission-and-occlusion layer: its pixels, or its 1×1 stand-in. */
export const emissiveAoBytes = (width: number, height: number, layer: boolean) =>
  layer ? width * height * EMISSIVE_AO_BYTES : EMISSIVE_AO_BYTES

/** A surface target of the buffer: `format` at `size`. */
const surfaceTarget = (device: GPUDevice, format: GPUTextureFormat, size: GPUExtent3DStrict) =>
  device.createTexture({
    label: `Trillion3D surface v1 ${format}`,
    size,
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  })

/**
 * The surface buffer of a `width` × `height` frame. Without `hasEmissiveAo`, the third target is a
 * 1×1 holding `(0, 0, 0, 1)`: an image none of whose surfaces emits or occludes
 * (`surfaceEmitsOrOccludes`) marks no texel, so its readers, which load the texel under the mark
 * alone (`surfaceEmissiveAo`), never read it; its passes leave the attachment empty.
 */
export function createSurfaceBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  hasSubsurface = false,
  hasEmissiveAo = true,
): SurfaceBuffer {
  const allocationBytes =
    checkSurfaceSize(device, width, height) +
    subsurfaceBytes(width, height, hasSubsurface) -
    emissiveAoBytes(width, height, true) +
    emissiveAoBytes(width, height, hasEmissiveAo)
  const textures: GPUTexture[] = []
  let subsurface: GPUTexture | undefined
  let receiver: GPUTexture | undefined
  try {
    SURFACE_FORMATS.forEach((format, at) => {
      const layer = at !== 2 || hasEmissiveAo
      textures.push(surfaceTarget(device, format, layer ? { width, height } : [1, 1]))
      if (!layer)
        device.queue.writeTexture(
          { texture: textures[at] },
          Uint16Array.of(0, 0, 0, HALF_ONE),
          { bytesPerRow: EMISSIVE_AO_BYTES },
          [1, 1],
        )
    })
    subsurface = device.createTexture({
      label: 'Trillion3D thin transmission',
      size: hasSubsurface ? [width, height] : [1, 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    })
    receiver = device.createTexture({
      label: 'Trillion3D shadow receiver',
      size: { width, height },
      format: RECEIVER_TARGET_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  } catch (error) {
    textures.forEach((texture) => texture.destroy())
    subsurface?.destroy()
    receiver?.destroy()
    throw error
  }
  return assemble({
    width,
    height,
    allocationBytes,
    textures,
    subsurface,
    receiver,
    hasSubsurface,
    hasEmissiveAo,
  })
}

/** `(0, 0, 0, 1)`'s last channel in half float. */
const HALF_ONE = 0x3c00

type SurfaceParts = Pick<
  SurfaceBuffer,
  'width' | 'height' | 'allocationBytes' | 'hasSubsurface' | 'hasEmissiveAo'
> & {
  textures: GPUTexture[]
  subsurface: GPUTexture
  receiver: GPUTexture
  /** Textures the buffer frees with its own though none of its members names them. */
  retired?: GPUTexture[]
}

function assemble(parts: SurfaceParts): SurfaceBuffer {
  const { textures, subsurface, receiver, retired = [] } = parts
  const views = textures.map((texture) => texture.createView())
  let disposed = false
  return {
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
    hasSubsurface: parts.hasSubsurface,
    hasEmissiveAo: parts.hasEmissiveAo,
    views: () => {
      if (disposed) throw new Error('SURFACE_DISPOSED')
      return views
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const texture of [...textures, ...retired]) texture.destroy()
      subsurface.destroy()
      receiver.destroy()
    },
  }
}

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
    width,
    height,
    allocationBytes:
      surfaces.allocationBytes -
      emissiveAoBytes(width, height, false) +
      emissiveAoBytes(width, height, true),
    textures: [surfaces.baseMetal, surfaces.normalRough, layer, surfaces.flags],
    subsurface: surfaces.subsurface,
    receiver: surfaces.receiver,
    hasSubsurface: surfaces.hasSubsurface,
    hasEmissiveAo: true,
    retired: [surfaces.emissiveAo],
  })
}
/** A surface buffer with the camera it was drawn from. */
export interface SurfaceCapture extends SurfaceBuffer {
  /** Reversed depth in [0,1], background at the far plane (`../camera/depthConvention.ts`). Opaque and
   *  masked geometry only. */
  readonly depth: GPUTexture
  /** Undoes the camera projection. */
  readonly inverseViewProjection: ReadonlyArray<number>
  /** Where the camera was. */
  readonly cameraWorld: readonly [number, number, number]
  /** Triangles drawn. */
  readonly selectedTriangles: number
}
