import type { PackedDag } from './selection.ts'
import {
  BACKEND,
  fakeDevice,
  type FakeDeviceOptions,
} from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { writtenTexels } from '../core/recordTexture.fixture.ts'

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
    /** The host rows the writes to the frame words sent (`cameraFrames.ts`), every write decoded
     *  into the rows it holds — one run of several included —, each as its first word's index in
     *  the host's rows and its words. */
    rows: () =>
      gpu.textureWrites
        .filter(({ destination }) => destination.texture.label === FRAME_TABLE.label)
        .flatMap((write) => {
          const { first, words } = writtenTexels(FRAME_TABLE, write as never)
          // A write of the frame words is whole rows, from a row's start: never a word alone.
          if (first % FRAME_ROW_WORDS || words.length % FRAME_ROW_WORDS)
            throw new Error(`a frames write of ${words.length} words at ${first} is no whole rows`)
          return Array.from(
            { length: words.length / FRAME_ROW_WORDS },
            (_, k): [number, Uint32Array] => [
              first + k * FRAME_ROW_WORDS,
              words.subarray(k * FRAME_ROW_WORDS, (k + 1) * FRAME_ROW_WORDS),
            ],
          )
        }),
  }
}
