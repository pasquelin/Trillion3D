import { writeSplitDouble } from '../../../../sdk-core/src/math/primitives/splitDouble.ts';
import type { PackedDag } from './types.ts';

/** Two vec4s per primitive, behind its range's unchanged 64-byte camera matrices. */
export const WORLD_ORIGIN_BYTES = 32;

/** Writes one exact placement translation as two floats per coordinate. */
function writeOrigin(
  out: Float32Array,
  at: number,
  source: NonNullable<PackedDag['worldSources']>[number],
) {
  const e = source.world.elements;
  for (let axis = 0; axis < 3; axis++)
    writeSplitDouble(out, at + axis, at + 4 + axis, e[12 + axis]);
}

export function createWorldOrigins(
  device: GPUDevice,
  ranges: readonly { first: number; count: number }[],
  buffers: readonly GPUBuffer[],
  sources: PackedDag['worldSources'],
) {
  const words = new Float32Array((sources?.length ?? 0) * 8),
    next = new Float32Array(8);
  return {
    hostBytes: words.byteLength + next.byteLength,
    /** Called only for physical pose changes, never for a camera rebase. */
    write() {
      if (!sources) return false;
      let from = Infinity,
        to = -1;
      for (let row = 0; row < sources.length; row++) {
        const at = row * 8;
        writeOrigin(next, 0, sources[row]);
        if (next.every((value, k) => Object.is(value, words[at + k]))) continue;
        words.set(next, at);
        from = Math.min(from, row);
        to = row;
      }
      if (to < from) return false;
      for (const [r, { first, count }] of ranges.entries()) {
        const a = Math.max(from, first),
          b = Math.min(to + 1, first + count);
        if (a < b)
          device.queue.writeBuffer(
            buffers[r],
            count * 64 + (a - first) * WORLD_ORIGIN_BYTES,
            words.buffer,
            a * WORLD_ORIGIN_BYTES,
            (b - a) * WORLD_ORIGIN_BYTES,
          );
      }
      return true;
    },
  };
}
