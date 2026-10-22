/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  COPY_DST = 2,
  RENDER_ATTACHMENT = 16

/** An image of one face of a cube: any source `copyExternalImageToTexture` takes that has a size. */
export type SkyCubemapImage = ImageBitmap | ImageData | HTMLCanvasElement | OffscreenCanvas

/**
 * The cube texture of six square images of one side, in the order of a cube texture's faces: +x,
 * -x, +y, -y, +z, -z. The images are 8-bit colour, read as sRGB and given to the capture in linear
 * light (`rgba8unorm-srgb`); a cube of more range is a texture the host makes (16 or 32-bit float
 * texels) and gives as it is. Handed to the capture as `SkyLightInputs.cubemap`.
 * @throws TypeError when the images are not six squares of one side.
 */
export function createSkyCubemapFromImages(
  device: GPUDevice,
  faces: readonly SkyCubemapImage[],
  label = 'Trillion3D sky light cubemap',
) {
  const side = faces[0]?.width
  if (faces.length !== 6 || !side || faces.some((f) => f.width !== side || f.height !== side))
    throw new TypeError('A sky light cubemap is six square images of one side')
  const texture = device.createTexture({
    label,
    size: { width: side, height: side, depthOrArrayLayers: 6 },
    format: 'rgba8unorm-srgb',
    usage: TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT,
  })
  faces.forEach((source, layer) =>
    device.queue.copyExternalImageToTexture(
      { source },
      { texture, origin: [0, 0, layer] },
      { width: side, height: side },
    ),
  )
  return texture
}
