// The engine's depth pyramid on its own, as the proofs that build or march it mount it: no
// partition owns its tested boxes and state, so two empty ones are attached in their place.
import { createGpuHiz } from '../../../packages/sdk-browser/src/gpu/hiz/factory.ts'

/** The Hi-Z of a `width` × `height` image on `device`, one view, and the two empty partition
 *  buffers attached to it, for whoever destroys them, `front` the front depth it folds in; refused by name when its kernels do not
 *  build. */
export async function standaloneHiz(
  device: GPUDevice,
  width: number,
  height: number,
  front?: () => GPUTextureView | undefined,
) {
  const hiz = await createGpuHiz(device, width, height, 1, front)
  if (!hiz) throw new Error('the Hi-Z does not build')
  const partition = [0, 1].map(() =>
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
  )
  hiz.attach(partition[0], partition[1])
  return { hiz, partition }
}
