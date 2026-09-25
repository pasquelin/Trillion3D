/** Version 1: opaque/masked material properties in linear space, before lighting.
 * No velocity or GI representation is claimed by this contract. */
export const SURFACE_FORMATS: GPUTextureFormat[] = [
  'rgba16float',
  'rgba16float',
  'rgba16float',
  'r32uint',
];
/** Bytes of the four surface targets per pixel. */
export const SURFACE_BYTES_PER_PIXEL = 28;
/** Virtual-texture feedback target: the tile rank a pixel asks for, written by hardware
 *  resolve then by transparents, reduced to counters for one pixel in sixteen. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint';
/** Color, depth, visibility, material depth, HDR, material surfaces, the transparent texture
 *  feedback target and optional two Hi-Z pyramids. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE');
  let bytes = width * height * 56;
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
  return bytes;
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
  /** 0 background, 1 unlit (fogged), 2 reads, 3 shown as-is: a diagnostic, a normal or depth view. */
  readonly flags: GPUTexture;
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
): SurfaceBuffer {
  const allocationBytes = checkSurfaceSize(device, width, height);
  const textures: GPUTexture[] = [];
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
  } catch (error) {
    textures.forEach((texture) => texture.destroy());
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
    views: () => {
      if (disposed) throw new Error('SURFACE_DISPOSED');
      return views;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.forEach((texture) => texture.destroy());
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
