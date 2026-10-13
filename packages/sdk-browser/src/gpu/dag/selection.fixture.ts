import type { PackedDag } from './selection.ts'
import {
  BACKEND,
  fakeDevice,
  type FakeDeviceOptions,
} from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { FRAME_VEC4 } from './types.ts'

/** Bytes of one host row of the frames. */
const ROW_BYTES = FRAME_VEC4 * 16

/**
 * The kit's device running the DAG selection on the CPU double of its kernel, its mappings meeting
 * `faults`, with the counts the selection tests read.
 */
export function mockDagDevice(
  packed: PackedDag,
  faults: Pick<FakeDeviceOptions, 'mapping' | 'failMap'> = {},
) {
  const gpu = fakeDevice({ ...BACKEND, packed, ...faults })
  return {
    device: gpu.device,
    uniformWrites: () =>
      gpu.writes.filter(({ buffer }) => buffer.size === DAG_UNIFORM_BYTES).length,
    /** Copies to a READABLE slot: one per due readback, never one per send. */
    readbackCopies: () => gpu.copies.filter(({ to }) => to.usage & GPUBufferUsage.MAP_READ).length,
    /** Mappings asked of a destroyed buffer: each one a validation error on the device. */
    destroyedMaps: gpu.destroyedMaps,
    /** The host rows the writes to the frames sent (`frameRanges.ts`), every write decoded into
     *  the rows it holds — one run of several included —, each as its first word's index in its
     *  buffer and its words. */
    rows: () =>
      gpu.writes
        .filter(({ buffer }) => buffer.label === 'Trillion3D DAG frames')
        .flatMap(({ offset, data }) => {
          const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          // A write of the frames is whole rows, from a row's start: never a word alone.
          if (offset % ROW_BYTES || bytes.byteLength % ROW_BYTES)
            throw new Error(`a frames write of ${bytes.byteLength} B at ${offset} is no whole rows`)
          return Array.from(
            { length: bytes.byteLength / ROW_BYTES },
            (_, k): [number, Uint32Array] => [
              (offset + k * ROW_BYTES) / 4,
              new Uint32Array(bytes.buffer, bytes.byteOffset + k * ROW_BYTES, ROW_BYTES / 4),
            ],
          )
        }),
  }
}
