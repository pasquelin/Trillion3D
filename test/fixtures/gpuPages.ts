type Copy = { from: unknown; fromOffset: number; to: unknown; toOffset: number; size: number };

export function mockDevice(limits: Record<string, number> = { maxBufferSize: 1024 }) {
  const writes: Array<{ offset: number; bytes: Uint8Array }> = [];
  // Buffer-to-buffer copies of a resize, in the order they are encoded.
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
      // `dataOffset` and `size` are honoured: what actually goes to the GPU is what the reading
      // must show, and a page that writes only its bytes is distinct from a whole slot.
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
