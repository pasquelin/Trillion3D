// Every device the page's WebGPU grants from now on, handed to a proof's hook as it is granted: the
// engine asks for its device itself, so a proof that watches it hooks the grant.

/** Calls `each` once on every device granted from now on, before the engine sees it. */
export function onGrantedDevices(each: (device: GPUDevice) => void) {
  // A device handed out again is hooked once: a page (or a proof's fake adapter) may resolve the
  // same device on every request, and a hook run twice would count its work twice.
  const seen = new WeakSet<GPUDevice>()
  const gpu = navigator.gpu
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (...args) => {
    const adapter = await requestAdapter(...args)
    if (!adapter) return adapter
    const requestDevice = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (...options) => {
      const device = await requestDevice(...options)
      if (!seen.has(device)) {
        seen.add(device)
        each(device)
      }
      return device
    }
    return adapter
  }
}
