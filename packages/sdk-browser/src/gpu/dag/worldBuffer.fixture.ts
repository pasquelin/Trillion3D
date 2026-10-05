// A whole world binding in one buffer: the camera matrices, then the origin tail the engine's
// ranges carry (`createWorldOrigins`), for the browser proofs that bind every primitive at once.
import { createWorldOrigins } from './worldOrigins.ts';
import type { PackedDag } from './types.ts';

/** `worlds`' matrices, then two vec4s of exact origin per source, as one range holds them. */
export function worldBufferWords(worlds: Float32Array, sources: PackedDag['worldSources']) {
  const count = worlds.length / 16,
    words = new Float32Array(count * 24);
  words.set(worlds);
  const device = {
    queue: {
      writeBuffer(_: unknown, offset: number, data: ArrayBuffer, from: number, size: number) {
        new Uint8Array(words.buffer).set(new Uint8Array(data, from, size), offset);
      },
    },
  } as unknown as GPUDevice;
  createWorldOrigins(device, [{ first: 0, count }], [{} as GPUBuffer], sources).write();
  return words;
}
