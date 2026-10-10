// The buffers a proof makes on its device, destroyed together when it is done.
export function heldBuffers(device: GPUDevice) {
  const made: GPUBuffer[] = []
  return {
    buffer(size: number, usage: number) {
      const created = device.createBuffer({ size, usage })
      made.push(created)
      return created
    },
    release: () => made.forEach((created) => created.destroy()),
  }
}
