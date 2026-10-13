// The GPU errors a world's own device raises: a world asks for its device itself (`holdWorldDevice`), which
// the proof's device errors (`runOnDevice`) do not see. Listened for from the adapter's grant, before the world
// is made; the proof asserts the list is empty.
import { hookAfter, type Proto } from '../../../bench/dawn/hook.ts'

/** Listens on every device the page's WebGPU grants from now on; the errors it raises fill the list, and
 *  the buffers and textures it makes are kept by label (`made`, `textures`), for a proof that reads one. */
export function listenToWorldDevices() {
  const errors: string[] = [],
    made = new Map<string, GPUBuffer>(),
    textures = new Map<string, GPUTexture>()
  const gpu = navigator.gpu
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (...args) => {
    const adapter = await requestAdapter(...args)
    if (!adapter) return adapter
    const requestDevice = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (...options) => {
      const device = await requestDevice(...options)
      device.addEventListener('uncapturederror', (event) => errors.push(event.error.message))
      const keep =
        <T>(into: Map<string, T>) =>
        (_device: object, [descriptor]: never[], resource: unknown) => {
          const label = (descriptor as GPUObjectDescriptorBase).label
          if (label) into.set(label, resource as T)
        }
      hookAfter(device as unknown as Proto, 'createBuffer', keep(made))
      hookAfter(device as unknown as Proto, 'createTexture', keep(textures))
      return device
    }
    return adapter
  }
  return { errors, made, textures }
}
