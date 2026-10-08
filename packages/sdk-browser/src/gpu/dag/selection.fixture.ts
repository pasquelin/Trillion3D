import type { PackedDag } from './selection.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import type { MapFaults } from '../../../../../tests/kit/gpu/mockBuffers.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { FRAME_VEC4 } from './types.ts'

/** Bytes of one host row of the frames. */
const ROW_BYTES = FRAME_VEC4 * 16

/**
 * The kit's device (`mockGpu`) running the DAG selection on the CPU double of its kernel, with
 * the counts the selection tests read.
 */
export function mockDagDevice(packed: PackedDag, faults: MapFaults = {}) {
  const gpu = mockGpu({ packed, ...faults })
  return {
    device: gpu.device,
    uniformWrites: () => gpu.writes.filter(({ size }) => size === DAG_UNIFORM_BYTES).length,
    /** Copies to a READABLE slot: one per due readback, never one per send. */
    readbackCopies: () => gpu.copyUsages.filter((usage) => usage & GPUBufferUsage.MAP_READ).length,
    /** Mappings asked of a destroyed buffer: each one a validation error on the device. */
    destroyedMaps: gpu.destroyedMaps,
    /** The host rows the writes to the frames sent (`frameRanges.ts`), every write decoded into
     *  the rows it holds — one run of several included —, each as its first word's index in its
     *  buffer and its words. */
    rows: () =>
      gpu.writes
        .filter(({ label }) => label === 'Trillion3D DAG frames')
        .flatMap(({ offset, bytes }) =>
          Array.from({ length: bytes.byteLength / ROW_BYTES }, (_, k): [number, Uint32Array] => [
            (offset + k * ROW_BYTES) / 4,
            new Uint32Array(bytes.buffer, bytes.byteOffset + k * ROW_BYTES, ROW_BYTES / 4),
          ]),
        ),
  }
}
