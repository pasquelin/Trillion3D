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
      // `dataOffset` et `size` sont respectés : ce qui part vraiment sur la carte est ce que le
      // relevé doit montrer, et une page qui n'écrit que ses octets se distingue d'un slot entier.
      writeBuffer: (
        _buffer: unknown,
        offset: number,
        data: Uint8Array,
        dataOffset = 0,
        size = data.byteLength - dataOffset,
      ) =>
        writes.push({
          offset,
          bytes: new Uint8Array(data.buffer, data.byteOffset + dataOffset, size).slice(),
        }),
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
