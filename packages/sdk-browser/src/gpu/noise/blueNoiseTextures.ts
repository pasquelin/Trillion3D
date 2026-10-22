import {
  BLUE_NOISE_PIXELS,
  BLUE_NOISE_VOLUME,
  blueNoiseBytes,
  loadedBlueNoiseBytes,
} from './blueNoiseSource.ts'

/** The format the blue noise is kept in: the scalar mask in the red channel and the vector mask in the green and the blue, so that
 *  one texture serves a pass that samples it and a stage that reads it as a storage texture (the fragments that
 *  spare their sampled textures), where core WebGPU has storage formats of four channels alone. */
export const BLUE_NOISE_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** Bytes of the texture: four a texel. */
export const BLUE_NOISE_TEXTURE_BYTES = BLUE_NOISE_PIXELS * 4

/** The blue noise on a device: its texture, `width × (depth · height)` texels read by `textureLoad` (`blueNoiseWgsl.ts`), and its view. */
export interface BlueNoiseTextures {
  texture: GPUTexture
  view: GPUTextureView
}

/** The texels the file's two masks make: the scalar one, the vector one's two values, and an opaque alpha. */
function texelsOf(bytes: Uint8Array) {
  const texels = new Uint8Array(BLUE_NOISE_TEXTURE_BYTES)
  for (let pixel = 0; pixel < BLUE_NOISE_PIXELS; pixel++) {
    texels[4 * pixel] = bytes[pixel]
    texels[4 * pixel + 1] = bytes[BLUE_NOISE_PIXELS + 2 * pixel]
    texels[4 * pixel + 2] = bytes[BLUE_NOISE_PIXELS + 2 * pixel + 1]
    texels[4 * pixel + 3] = 255
  }
  return texels
}

/** The blue noise made on `device` from the file's bytes. */
export function createBlueNoiseTextures(device: GPUDevice, bytes: Uint8Array): BlueNoiseTextures {
  const { width, height, depth } = BLUE_NOISE_VOLUME
  const size = [width, height * depth] as const
  const texture = device.createTexture({
    label: 'Trillion3D blue noise',
    size,
    format: BLUE_NOISE_FORMAT,
    usage:
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    texelsOf(bytes) as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width * 4 },
    size,
  )
  return { texture, view: texture.createView() }
}

/** What a device holds of its blue noise: the making, its textures once made, and whether it was refused. */
interface DeviceNoise {
  promise: Promise<BlueNoiseTextures>
  textures?: BlueNoiseTextures
  refused?: boolean
}

const noises = new WeakMap<GPUDevice, DeviceNoise>()

/** The textures of `device` from the file's bytes, or the refusal (the budget) as the device's answer. */
function makeFrom(
  device: GPUDevice,
  entry: { textures?: BlueNoiseTextures; refused?: boolean },
  bytes: Uint8Array,
) {
  try {
    return (entry.textures = createBlueNoiseTextures(device, bytes))
  } catch (error) {
    entry.refused = true
    throw error
  }
}

/** The blue noise of `device`, read from the file and made once, when first asked — at once where another device has read the file —:
 *  what resolves is every pass's. A refusal (the file missing, the budget) is the device's answer: it is not asked again. */
export function blueNoiseTextures(device: GPUDevice) {
  let noise = noises.get(device)
  if (!noise) {
    const entry: Pick<DeviceNoise, 'textures' | 'refused'> = {}
    const bytes = loadedBlueNoiseBytes()
    const promise = (async () =>
      makeFrom(
        device,
        entry,
        bytes ??
          (await blueNoiseBytes().catch((error: unknown) => {
            entry.refused = true
            throw error
          })),
      ))()
    noises.set(device, (noise = Object.assign(entry, { promise })))
  }
  return noise.promise
}

/** Whether `device` was refused its blue noise: the file could not be read, or the budget had no room. */
export const blueNoiseRefused = (device: GPUDevice) => noises.get(device)?.refused === true

/** The blue noise of `device` if it is made, else none — and, the first time, its making begun: for the pass that builds
 *  synchronously and does without it a frame or two (`blueNoiseTextures` is what a frame waits on). */
export function blueNoiseNow(device: GPUDevice) {
  blueNoiseTextures(device).catch(() => undefined)
  return noises.get(device)?.textures
}
