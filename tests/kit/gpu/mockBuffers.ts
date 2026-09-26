/** What a mock buffer's mapping meets: a refusal, or a gate the test opens when it chooses. */
export type MapFaults = { failMap?: boolean; mapGate?: Promise<void> };

type MockBuffer = {
  label?: string;
  size: number;
  usage: number;
  data: Uint8Array;
  destroyed: boolean;
};

/**
 * Buffers that map as on a real device: mapping a destroyed buffer is a validation error on the
 * device (`OperationError`, counted by `destroyedMaps`); a mapping the destruction cuts short
 * rejects with `AbortError`; unmapping does nothing. `failMap` refuses every mapping but the
 * explicit capture's.
 */
export function mockBuffers({ failMap = false, mapGate }: MapFaults) {
  const buffers: MockBuffer[] = [];
  let destroyedMaps = 0;
  const createBuffer = ({
    size,
    usage,
    label,
  }: {
    size: number;
    usage: number;
    label?: string;
  }) => {
    const buffer = {
      size,
      usage,
      label,
      data: new Uint8Array(size),
      destroyed: false,
      destroy: () => void (buffer.destroyed = true),
      mapAsync: async () => {
        if (buffer.destroyed) {
          destroyedMaps++;
          throw new DOMException('destroyed', 'OperationError');
        }
        if (failMap && label !== 'Trillion3D explicit capture') throw new Error('MAP_FAILED');
        await mapGate;
        if (buffer.destroyed) throw new DOMException('destroyed while mapping', 'AbortError');
      },
      getMappedRange: () => buffer.data.buffer,
      unmap() {},
    };
    buffers.push(buffer);
    return buffer;
  };
  return { buffers, createBuffer, destroyedMaps: () => destroyedMaps };
}
