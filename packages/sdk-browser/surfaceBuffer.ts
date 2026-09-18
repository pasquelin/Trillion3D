/** Version 1: opaque/masked material properties in linear space, before lighting.
 * No velocity or GI representation is claimed by this contract. */
export const SURFACE_FORMATS: GPUTextureFormat[] = [
  'rgba16float',
  'rgba16float',
  'rgba16float',
  'r32uint',
];
const SURFACE_BYTES_PER_PIXEL = 28;
/** La cible de retour des textures virtuelles : le rang de tuile qu'un pixel demande, écrit par la
 *  résolution matérielle puis par les transparents, réduit en compteurs pour un pixel sur seize. */
export const FEEDBACK_FORMAT: GPUTextureFormat = 'r32uint';
/** Color, depth, visibility, HDR, material surfaces, the transparent texture feedback target and
 *  optional two Hi-Z pyramids. */
export function frameTargetBytes(width: number, height: number, withHiz: boolean) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE');
  let bytes = width * height * 52;
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
export interface SurfaceBuffer {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly allocationBytes: number;
  /** RGB base color, A metalness. */
  readonly baseMetal: GPUTexture;
  /** XYZ world normal, A roughness. */
  readonly normalRough: GPUTexture;
  /** RGB emission, A ambient occlusion. */
  readonly emissiveAo: GPUTexture;
  /** 0 background, 1 unlit, 2 lit, 3 display-space diagnostic. */
  readonly flags: GPUTexture;
  views(): GPUTextureView[];
  dispose(): void;
}
export function checkSurfaceSize(
  device: GPUDevice,
  width: number,
  height: number,
  budgetBytes: number,
  bytesPerPixel = SURFACE_BYTES_PER_PIXEL,
) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_SURFACE_SIZE');
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1)
    throw new Error('INVALID_SURFACE_BUDGET');
  if (
    width > (device.limits.maxTextureDimension2D ?? 8192) ||
    height > (device.limits.maxTextureDimension2D ?? 8192)
  )
    throw new Error('SURFACE_DEVICE_LIMIT');
  const bytes = width * height * bytesPerPixel;
  if (!Number.isSafeInteger(bytes) || bytes > budgetBytes)
    throw new Error(`SURFACE_BUDGET: ${bytes} > ${budgetBytes}`);
  return bytes;
}
export function createSurfaceBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  budgetBytes: number,
): SurfaceBuffer {
  const allocationBytes = checkSurfaceSize(device, width, height, budgetBytes);
  const textures: GPUTexture[] = [];
  let views: GPUTextureView[];
  try {
    for (const format of SURFACE_FORMATS)
      textures.push(
        device.createTexture({
          label: `WG surface v1 ${format}`,
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
export interface SurfaceCapture extends SurfaceBuffer {
  /** Profondeur inversée dans [0,1], fond au lointain (`depthConvention.ts`). Géométrie opaque et
   *  à masque seulement. */
  readonly depth: GPUTexture;
  readonly inverseViewProjection: ReadonlyArray<number>;
  readonly cameraWorld: readonly [number, number, number];
  readonly selectedTriangles: number;
}
