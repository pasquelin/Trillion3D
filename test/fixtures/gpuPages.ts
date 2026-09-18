type Copy = { from: unknown; fromOffset: number; to: unknown; toOffset: number; size: number };

export function mockDevice(limits: Record<string, number> = { maxBufferSize: 1024 }) {
  const writes: Array<{ offset: number; bytes: Uint8Array }> = [];
  // Les copies de tampon à tampon d'un redimensionnement, dans l'ordre où elles sont encodées.
  const copies: Copy[] = [];
  let fences = 0,
    destroyed = 0;
  const device = {
    limits,
    createBuffer: () => ({
      destroy() {
        destroyed++;
      },
    }),
    createCommandEncoder: () => ({
      copyBufferToBuffer: (
        from: unknown,
        fromOffset: number,
        to: unknown,
        toOffset: number,
        size: number,
      ) => copies.push({ from, fromOffset, to, toOffset, size }),
      finish: () => ({}),
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
      submit() {},
      onSubmittedWorkDone: async () => {
        fences++;
      },
    },
  };
  return {
    device: device as unknown as GPUDevice,
    writes,
    copies,
    fences: () => fences,
    destroyed: () => destroyed,
  };
}
