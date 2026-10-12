// The GPU errors a world's own device raises: a world asks for its device itself (`holdWorldDevice`), which
// the proof's device errors (`runOnDevice`) do not see. Listened for from the adapter's grant, before the world
// is made; the proof asserts the list is empty.

/** Listens on every device the page's WebGPU grants from now on; the errors it raises fill the list, and
 *  the buffers it makes are kept by label (`made`), for a proof that reads one. */
export function listenToWorldDevices() {
  const errors: string[] = [],
    made = new Map<string, GPUBuffer>()
  const gpu = navigator.gpu
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (...args) => {
    const adapter = await requestAdapter(...args)
    if (!adapter) return adapter
    const requestDevice = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (...options) => {
      const device = await requestDevice(...options)
      device.addEventListener('uncapturederror', (event) => errors.push(event.error.message))
      const createBuffer = device.createBuffer.bind(device)
      device.createBuffer = (descriptor) => {
        const buffer = createBuffer(descriptor)
        if (descriptor.label) made.set(descriptor.label, buffer)
        return buffer
      }
      return device
    }
    return adapter
  }
  return { errors, made }
}

/** The first `count` words of `buffer`, read back on `device` (a buffer made with `COPY_SRC`). */
export async function readWords(device: GPUDevice, buffer: GPUBuffer, count: number) {
  const staging = device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, count * 4)
  device.queue.submit([encoder.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const words = Array.from(new Uint32Array(staging.getMappedRange().slice(0)))
  staging.destroy()
  return words
}
