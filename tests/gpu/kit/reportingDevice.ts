// A device that reports a smaller binding than it holds: what a proof splits the engine's tables on,
// the device underneath the same (`../dag/frameRangesPage.ts`, `../reflections/proxyTablesPage.ts`).

/** `device` reporting `binding` bytes per buffer and per storage binding, every other limit and
 *  every call its own. */
export function reporting(device: GPUDevice, binding: number) {
  const capped = new Set<PropertyKey>(['maxBufferSize', 'maxStorageBufferBindingSize'])
  const limits = new Proxy(device.limits, {
    get: (target, key) => (capped.has(key) ? binding : Reflect.get(target, key, target)),
  })
  return new Proxy(device, {
    get: (target, key) => {
      if (key === 'limits') return limits
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
