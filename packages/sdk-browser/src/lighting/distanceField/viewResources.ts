import { retire } from '../../gpu/core/frameRetire.ts'

/** A texture of a view and the view the passes bind it through. */
export interface ViewTexture {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}

/**
 * The buffers and textures of one view of the distance fields' programs, named `name` after
 * `label`, and kept to be given back together (`dispose`, after the frames in flight): a buffer is
 * never under a vector's, a texture never under a texel.
 */
export function viewResources(device: GPUDevice, label: string) {
  const made: { destroy(): void }[] = []
  return {
    buffer(name: string, bytes: number, usage: number) {
      const gpu = device.createBuffer({
        label: `${label} ${name}`,
        size: Math.max(bytes, 16),
        usage,
      })
      made.push(gpu)
      return gpu
    },
    texture(
      name: string,
      size: readonly number[],
      format: GPUTextureFormat,
      usage: number,
    ): ViewTexture {
      const gpu = device.createTexture({
        label: `${label} ${name}`,
        size: [Math.max(size[0], 1), Math.max(size[1], 1)],
        format,
        usage,
      })
      made.push(gpu)
      return { texture: gpu, view: gpu.createView() }
    },
    dispose: () =>
      retire(device, { destroy: () => made.forEach((resource) => resource.destroy()) }),
  }
}
