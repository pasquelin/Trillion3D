import { isImageSize } from '../../../../math/src/scalar/integers.ts'
import { SUBSURFACE_TARGET } from './subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from './physicalLobes.ts'
import { pyramidHeldBytes } from '../../visibility/hiz/gpu/pyramid.ts'
import { EMISSIVE_AO_BYTES } from './surfaceEmission.ts'
import { textureLimits } from '../../gpu/core/textureLimits.ts'
import { texelBytesOf, wantedTargetBytes } from '../../gpu/core/textureBytes.ts'
import {
  DEPTH_FORMAT,
  DISPLAY_FORMAT,
  FEEDBACK_FORMAT,
  HDR_FORMAT,
} from '../../scene/targetFormats.ts'
import { SURFACE_OUTPUTS } from './surfaceOutputs.ts'

/** Bytes of one texel of each of `formats`, summed (`texelBytesOf`). */
const texelSum = (...formats: GPUTextureFormat[]) =>
  formats.reduce((sum, format) => sum + texelBytesOf(format), 0)

/** Version 1: opaque/masked material properties in linear space, before lighting.
 * No velocity or GI representation is claimed by this contract. The flags hold a model of 0 to 5
 * and three marks (`SurfaceBuffer.views`), written by the opaque resolve alone: eight bits keep
 * every one, in a 32-bit word, the narrowest a compute stage stores. The four surfaces' formats, in
 * the order of their views (`SURFACE_OUTPUTS`). */
export const SURFACE_FORMATS: GPUTextureFormat[] = SURFACE_OUTPUTS.map(({ format }) => format)
/** Bytes of the four surfaces per pixel. */
export const SURFACE_BYTES_PER_PIXEL = texelSum(...SURFACE_FORMATS)
/** Bytes per pixel of the feedback target, made only while the pipelines write it
 *  (`../../frame/prepare/feedbackVariant.ts`). */
export const FEEDBACK_BYTES = texelSum(FEEDBACK_FORMAT)
/** Bytes per pixel of the frame's targets beside the surfaces: the display colour, the depth, the
 *  visibility, the HDR colour and the texture feedback. */
const FRAME_BYTES_PER_PIXEL = texelSum(
  DISPLAY_FORMAT,
  DEPTH_FORMAT,
  'r32uint',
  HDR_FORMAT,
  FEEDBACK_FORMAT,
)
/** Color, depth, visibility, HDR, material surfaces, the transparent texture feedback target and
 *  the optional Hi-Z pyramid. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!isImageSize(width, height)) throw new Error('INVALID_SURFACE_SIZE')
  let bytes = width * height * (FRAME_BYTES_PER_PIXEL + SURFACE_BYTES_PER_PIXEL)
  if (withHiz) bytes += pyramidHeldBytes(width, height)
  return bytes + SUBSURFACE_TARGET.texelBytes + PHYSICAL_LOBES_TARGET.texelBytes
}
/**
 * Per-pixel surface data of a frame, kept on the GPU: depth, normals, material. Two layered
 * targets hold it, so that the material classes store every surface through two storage bindings
 * (`../../visibility/shader/shadeOutputsWgsl.ts`):
 * - the colours (`SURFACE_COLOURS_FORMAT`): RGB base color and A metalness; XYZ world normal and A
 *   roughness; then, while `hasEmissiveAo`, RGB emission and A ambient occlusion; then, while
 *   `hasSubsurface`, the independent thin-surface transmission color;
 * - the words (`SURFACE_WORDS_FORMAT`): the flags — low three bits 0 background, 1 unlit (fogged),
 *   2 reads, 3 shown as-is: a diagnostic, a normal or depth view; 4 and 5 the diffuse and toon
 *   models (`./surfaceModel.ts`); above them, marks: 16 an emission-and-occlusion texel other than
 *   (0, 0, 0, 1) (`./surfaceEmission.ts`), 32 a thin transmission, 64 an anisotropic or clear-coat
 *   lobe (`./physicalLobes.ts`), 128 no fog.
 * Its readers bind views, each one layer, the same formats whatever holds them.
 */
export interface SurfaceBuffer {
  /** Format version. */
  readonly version: 1
  /** Width in pixels. */
  readonly width: number
  /** Height in pixels. */
  readonly height: number
  /** GPU bytes it holds. */
  readonly allocationBytes: number
  /** The colour layers (above). */
  readonly colours: GPUTexture
  /** The word layers (above). */
  readonly words: GPUTexture
  /** The layers of the colours the emission and occlusion, then the thin transmission, are in, a
   *  byte each, the first lowest: 0 for one the frame does not hold. What the material classes read
   *  to store them (`SHADE_BIN_LAYERS`). */
  readonly layers: number
  /** View of the thin-surface transmission colour; a 1×1 zero texture's when disabled. */
  readonly subsurfaceView: GPUTextureView
  /** The anisotropic and clear-coat lobes of each pixel (`./physicalLobes.ts`); a 1×1 texture
   *  when no surface carries one. */
  readonly lobes: GPUTexture
  /** The view of `lobes` the resolve writes and the lighting reads. */
  readonly lobesView: GPUTextureView
  /** Whether the emission-and-occlusion layer has its pixels; a 1×1 `(0, 0, 0, 1)` otherwise. */
  readonly hasEmissiveAo: boolean
  /** Whether the thin transmission has its pixels. */
  readonly hasSubsurface: boolean
  /** The views of the four surfaces, in the order of `SURFACE_OUTPUTS`. */
  views(): GPUTextureView[]
  /** The colours and the words, every layer of each, as the material classes store them. */
  stores(): readonly [GPUTextureView, GPUTextureView]
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
  if (!isImageSize(width, height)) throw new Error('INVALID_SURFACE_SIZE')
  if (Math.max(width, height) > textureLimits(device.limits).side)
    throw new Error('SURFACE_DEVICE_LIMIT')
  const bytes = width * height * bytesPerPixel
  if (!Number.isSafeInteger(bytes)) throw new Error('INVALID_SURFACE_SIZE')
  return bytes
}
/** What the frame takes of the emission-and-occlusion layer: its pixels, or its 1×1 stand-in. */
export const emissiveAoBytes = (width: number, height: number, layer: boolean) =>
  wantedTargetBytes(width, height, layer, EMISSIVE_AO_BYTES)

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
  /** Reversed depth in [0,1], background at the far plane (`../../camera/depthConvention.ts`). Opaque and
   *  masked geometry only. */
  readonly depth: GPUTexture
  /** Undoes the camera projection. */
  readonly inverseViewProjection: ReadonlyArray<number>
  /** Where the camera was. */
  readonly cameraWorld: readonly [number, number, number]
  /** Triangles drawn. */
  readonly selectedTriangles: number
}
