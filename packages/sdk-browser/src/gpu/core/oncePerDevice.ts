/**
 * `make`, run once a device and kept for every later caller: what prepare compiles is what a later
 * frame finds made. A promise that rejects is dropped, and made again at the next call.
 */
export function oncePerDevice<T>(make: (device: GPUDevice) => T) {
  const made = new WeakMap<GPUDevice, T>();
  return (device: GPUDevice) => {
    if (made.has(device)) return made.get(device)!;
    const value = make(device);
    made.set(device, value);
    if (value instanceof Promise) value.catch(() => made.delete(device));
    return value;
  };
}
