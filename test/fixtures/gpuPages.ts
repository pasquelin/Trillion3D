export function mockDevice(limits: Record<string, number> = { maxBufferSize: 1024 }) {
  const writes: Array<{ offset: number; bytes: Uint8Array }> = [];
  let fences = 0,
    destroyed = 0;
  const device = {
    limits,
    createBuffer: () => ({
      destroy() {
        destroyed++;
      },
    }),
    queue: {
      writeBuffer: (_buffer: unknown, offset: number, data: Uint8Array) =>
        writes.push({ offset, bytes: new Uint8Array(data) }),
      onSubmittedWorkDone: async () => {
        fences++;
      },
    },
  };
  return {
    device: device as unknown as GPUDevice,
    writes,
    fences: () => fences,
    destroyed: () => destroyed,
  };
}
