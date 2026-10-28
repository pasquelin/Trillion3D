/**
 * `make`, run once a device and kept for every later caller: what prepare compiles is what a later
 * frame finds made. A promise that rejects or makes nothing is dropped, and made again at the next
 * call: one failed build is never kept as the device's answer.
 */
export function oncePerDevice<T>(make: (device: GPUDevice) => T) {
  const made = new WeakMap<GPUDevice, T>()
  return (device: GPUDevice) => {
    let value = made.get(device)
    if (value !== undefined) return value
    value = make(device)
    made.set(device, value)
    if (value instanceof Promise)
      value.then(
        (result) => result === undefined && made.delete(device),
        () => made.delete(device),
      )
    return value
  }
}

/**
 * `make`, run once a device and a key and kept for every later caller of both: what a build that depends on a choice (a storage format) compiles
 * is found made at a later frame. A promise that rejects or makes nothing is dropped, and made again at the next call, as `oncePerDevice` does.
 */
export function oncePerDeviceKey<K, T>(make: (device: GPUDevice, key: K) => T) {
  const made = new WeakMap<GPUDevice, Map<K, T>>()
  return (device: GPUDevice, key: K) => {
    let ofDevice = made.get(device)
    if (!ofDevice) made.set(device, (ofDevice = new Map()))
    let value = ofDevice.get(key)
    if (value !== undefined) return value
    const held = ofDevice
    value = make(device, key)
    held.set(key, value)
    if (value instanceof Promise)
      value.then(
        (result) => result === undefined && held.delete(key),
        () => held.delete(key),
      )
    return value
  }
}
