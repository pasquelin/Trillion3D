// The engine's depth pyramid on its own, as the proofs that build or march it mount it.
import { createGpuHiz } from '../../../packages/sdk-browser/src/visibility/hiz/gpu/factory.ts'

/** The Hi-Z of a `width` × `height` image on `device`, one view; refused by name when its kernels
 *  do not build. */
export async function standaloneHiz(device: GPUDevice, width: number, height: number) {
  const hiz = await createGpuHiz(device, width, height)
  if (!hiz) throw new Error('the Hi-Z does not build')
  return { hiz }
}
