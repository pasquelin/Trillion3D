import { SUBSURFACE_BYTES } from './subsurface.ts';
import { SHADING_OFFSET_BYTES } from '../visibility/shader/shadingPoint.ts';
import { storageBufferCap } from '../residency/pools.ts';

/** Version 1: opaque/masked material properties in linear space, before lighting.
 * No velocity or GI representation is claimed by this contract. The flags hold a value of 0 to 5
 * (`SurfaceBuffer.flags`), written by the opaque resolve alone: eight bits keep every one. */
export const SURFACE_FORMATS: GPUTextureFormat[] = [
  'rgba16float',
  'rgba16float',
  'rgba16float',
  'r8uint',
];
/** Bytes of the four surface targets per pixel. */
export const SURFACE_BYTES_PER_PIXEL = 25 + SHADING_OFFSET_BYTES;
/** Display colour target, what the composition writes; before it, the water pass borrows it. */
export const DISPLAY_FORMAT: GPUTextureFormat = 'rgba8unorm';
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in sixteen. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint';
/** Color, depth, visibility, material depth, HDR, material surfaces, the transparent texture
 *  feedback target and optional two Hi-Z pyramids. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE');
  // Colour, depth, visibility and material depth take 4 bytes each, HDR 8, the feedback 4.
  let bytes = width * height * (28 + SURFACE_BYTES_PER_PIXEL);
  if (withHiz) {
    bytes += width * height * 4;
    let w = width,
      h = height;
    for (;;) {
      bytes += w * h * 8;
      if (w === 1 && h === 1) break;
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
    }
  }
  return bytes + SUBSURFACE_BYTES;
}
/** Per-pixel surface data of a frame, kept on the GPU: depth, normals, material. */
export interface SurfaceBuffer {
  /** Format version. */
  readonly version: 1;
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
  /** GPU bytes it holds. */
  readonly allocationBytes: number;
  /** RGB base color, A metalness. */
  readonly baseMetal: GPUTexture;
  /** XYZ world normal, A roughness. */
  readonly normalRough: GPUTexture;
  /** RGB emission, A ambient occlusion. */
  readonly emissiveAo: GPUTexture;
  /** 0 background, 1 unlit (fogged), 2 reads, 3 shown as-is: a diagnostic, a normal or depth view;
   *  4 and 5 the diffuse and toon models (`./surfaceModel.ts`). */
  readonly flags: GPUTexture;
  /** Full precision shadow receiver offset, written beside the G-buffer. */
  readonly shadingOffset: GPUBuffer;
  /** Independent thin-surface transmission color; a 1×1 zero texture when disabled. */
  readonly subsurface: GPUTexture;
  /** View of the thin-surface transmission texture. */
  readonly subsurfaceView: GPUTextureView;
  /** Whether thin-surface transmission has a full-size target. */
  readonly hasSubsurface: boolean;
  /** Its GPU texture views. */
  views(): GPUTextureView[];
  /** Frees it. */
  dispose(): void;
}
/**
 * Bytes a surface of this size takes, once DEVICE limits are checked.
 * No byte ceiling is set here: as in the reference, targets follow resolution,
 * and only what the device declares it cannot do is refused, by name.
 */
export function checkSurfaceSize(
  device: GPUDevice,
  width: number,
  height: number,
  bytesPerPixel = SURFACE_BYTES_PER_PIXEL,
) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE');
  if (
    width > (device.limits.maxTextureDimension2D ?? 8192) ||
    height > (device.limits.maxTextureDimension2D ?? 8192)
  )
    throw new Error('SURFACE_DEVICE_LIMIT');
  const bytes = width * height * bytesPerPixel;
  if (!Number.isSafeInteger(bytes)) throw new Error('INVALID_SURFACE_SIZE');
  return bytes;
}
export function createSurfaceBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  hasSubsurface = false,
): SurfaceBuffer {
  const allocationBytes =
    checkSurfaceSize(device, width, height) +
    (hasSubsurface ? width * height : 1) * SUBSURFACE_BYTES;
  const offsetBytes = width * height * SHADING_OFFSET_BYTES;
  if (offsetBytes > storageBufferCap(device.limits)) throw new Error('SHADING_POINT_DEVICE_LIMIT');
  const textures: GPUTexture[] = [];
  let shadingOffset: GPUBuffer | undefined;
  let subsurface: GPUTexture | undefined;
  let views: GPUTextureView[];
  try {
    for (const format of SURFACE_FORMATS)
      textures.push(
        device.createTexture({
          label: `Trillion3D surface v1 ${format}`,
          size: { width, height },
          format,
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST,
        }),
      );
    views = textures.map((texture) => texture.createView());
    subsurface = device.createTexture({
      label: 'Trillion3D thin transmission',
      size: hasSubsurface ? [width, height] : [1, 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    shadingOffset = device.createBuffer({
      label: 'Trillion3D shadow receiver offset',
      size: offsetBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
  } catch (error) {
    textures.forEach((texture) => texture.destroy());
    shadingOffset?.destroy();
    subsurface?.destroy();
    throw error;
  }
  let disposed = false;
  return {
    version: 1,
    width,
    height,
    allocationBytes,
    baseMetal: textures[0],
    normalRough: textures[1],
    emissiveAo: textures[2],
    flags: textures[3],
    shadingOffset,
    subsurface,
    subsurfaceView: subsurface.createView(),
    hasSubsurface,
    views: () => {
      if (disposed) throw new Error('SURFACE_DISPOSED');
      return views;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.forEach((texture) => texture.destroy());
      shadingOffset.destroy();
      subsurface.destroy();
    },
  };
}
/** A surface buffer with the camera it was drawn from. */
export interface SurfaceCapture extends SurfaceBuffer {
  /** Reversed depth in [0,1], background at the far plane (`../camera/depthConvention.ts`). Opaque and
   *  masked geometry only. */
  readonly depth: GPUTexture;
  /** Undoes the camera projection. */
  readonly inverseViewProjection: ReadonlyArray<number>;
  /** Where the camera was. */
  readonly cameraWorld: readonly [number, number, number];
  /** Triangles drawn. */
  readonly selectedTriangles: number;
}
