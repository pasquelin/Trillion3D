import { SUBSURFACE_TARGET } from './subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from './physicalLobes.ts'
import { pyramidHeldBytes } from '../gpu/hiz/pyramid.ts'
import { EMISSIVE_AO_BYTES } from './surfaceEmission.ts'
import { textureLimits } from '../gpu/core/textureLimits.ts'
import { RECEIVER_TARGET_BYTES } from '../visibility/shader/receiverTargetWgsl.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'

/** Bytes of one texel of each of `formats`, summed (`textureBytesOf`). */
const texelBytesOf = (...formats: GPUTextureFormat[]) =>
  formats.reduce((sum, format) => sum + textureBytesOf({ size: [1, 1], format })!, 0)

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
export const SURFACE_BYTES_PER_PIXEL = texelBytesOf(...SURFACE_FORMATS) + RECEIVER_TARGET_BYTES
/** Display colour target, what the composition writes; before it, the water pass borrows it. */
export const DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in sixteen. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint'
/** Bytes per pixel of the feedback target, made only while the pipelines write it
 *  (`../webgpu/pages/prepare/feedbackVariant.ts`). */
export const FEEDBACK_BYTES = texelBytesOf(FEEDBACK_FORMAT)
/** Bytes per pixel of the frame's targets beside the surfaces: the display colour, the depth, the
 *  visibility, the HDR colour and the texture feedback. */
const FRAME_BYTES_PER_PIXEL = texelBytesOf(
  DISPLAY_FORMAT,
  'depth32float',
  'r32uint',
  'rgba16float',
  FEEDBACK_FORMAT,
)
/** Color, depth, visibility, HDR, material surfaces, the transparent texture feedback target and
 *  the optional Hi-Z pyramid. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE')
  let bytes = width * height * (FRAME_BYTES_PER_PIXEL + SURFACE_BYTES_PER_PIXEL)
  if (withHiz) bytes += pyramidHeldBytes(width, height)
  return bytes + SUBSURFACE_TARGET.texelBytes + PHYSICAL_LOBES_TARGET.texelBytes
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
   *  transmission, 64 an anisotropic or clear-coat lobe (`./physicalLobes.ts`), 128 no fog. */
  readonly flags: GPUTexture
  /** Independent thin-surface transmission color; a 1×1 zero texture when disabled (`holds`). */
  readonly subsurface: GPUTexture
  /** View of the thin-surface transmission texture. */
  readonly subsurfaceView: GPUTextureView
  /** The shadow receiver of each pixel (`../visibility/shader/receiverTargetWgsl.ts`). */
  readonly receiver: GPUTexture
  /** The view of `receiver` the shading pass writes and the lighting reads. */
  readonly receiverView: GPUTextureView
  /** The anisotropic and clear-coat lobes of each pixel (`./physicalLobes.ts`); a 1×1 texture
   *  when no surface carries one. */
  readonly lobes: GPUTexture
  /** The view of `lobes` the resolve writes and the lighting reads. */
  readonly lobesView: GPUTextureView
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
  if (Math.max(width, height) > textureLimits(device.limits).side)
    throw new Error('SURFACE_DEVICE_LIMIT')
  const bytes = width * height * bytesPerPixel
  if (!Number.isSafeInteger(bytes)) throw new Error('INVALID_SURFACE_SIZE')
  return bytes
}
/** What the frame takes of the emission-and-occlusion layer: its pixels, or its 1×1 stand-in. */
export const emissiveAoBytes = (width: number, height: number, layer: boolean) =>
  layer ? width * height * EMISSIVE_AO_BYTES : EMISSIVE_AO_BYTES

/** Whether `texture`, an optional target of `surfaces`, is the size `wanted` asks: the frame's,
 *  or 1×1. Wanted, it holds every pixel. */
export const holds = (
  surfaces: Pick<SurfaceBuffer, 'width' | 'height'>,
  texture: GPUTexture,
  wanted = true,
) =>
  texture.width === (wanted ? surfaces.width : 1) &&
  texture.height === (wanted ? surfaces.height : 1)

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
