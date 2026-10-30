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

/** What holds the values of one device by key: a key that is an object is held weakly, so that a value made for a key nothing names any more goes with it (a set of programs a session replaced); the other keys (a format, a flag) are held for good. */
function keyedValues<K, T>() {
  const named = new Map<K, T>(),
    objects = new WeakMap<WeakKey, T>()
  const isObject = (key: K): key is K & WeakKey =>
    (typeof key === 'object' && key !== null) || typeof key === 'function'
  return {
    get: (key: K) => (isObject(key) ? objects.get(key) : named.get(key)),
    set: (key: K, value: T) =>
      void (isObject(key) ? objects.set(key, value) : named.set(key, value)),
    delete: (key: K) => void (isObject(key) ? objects.delete(key) : named.delete(key)),
  }
}

/**
 * `make`, run once a device and a key and kept for every later caller of both: what a build that depends on a choice (a storage format) compiles
 * is found made at a later frame. A promise that rejects or makes nothing is dropped, and made again at the next call, as `oncePerDevice` does.
 * A key that is an object is held weakly: the value goes when nothing names the key.
 */
export function oncePerDeviceKey<K, T>(make: (device: GPUDevice, key: K) => T) {
  const made = new WeakMap<GPUDevice, ReturnType<typeof keyedValues<K, T>>>()
  return Object.assign(
    (device: GPUDevice, key: K) => {
      let ofDevice = made.get(device)
      if (!ofDevice) made.set(device, (ofDevice = keyedValues<K, T>()))
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
    },
    {
      /** Drops the value of a device and a key: a key that was a text is not kept for good. The next call makes it again. */
      forget: (device: GPUDevice, key: K) => void made.get(device)?.delete(key),
    },
  )
}
