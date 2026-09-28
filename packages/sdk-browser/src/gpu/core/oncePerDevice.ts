/**
 * `make`, run once a device and kept for every later caller: what prepare compiles is what a later
 * frame finds made. A promise that rejects or makes nothing is dropped, and made again at the next
 * call: one failed build is never kept as the device's answer.
 */
export function oncePerDevice<T>(make: (device: GPUDevice) => T) {
  const made = new WeakMap<GPUDevice, T>();
  return (device: GPUDevice) => {
    let value = made.get(device);
    if (value !== undefined) return value;
    value = make(device);
    made.set(device, value);
    if (value instanceof Promise)
      value.then(
        (result) => result === undefined && made.delete(device),
        () => made.delete(device),
      );
    return value;
  };
}
