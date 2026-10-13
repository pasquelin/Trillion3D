import type { PackedDag } from './selection.ts'
import {
  BACKEND,
  fakeDevice,
  type FakeDeviceOptions,
} from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { textureExtent } from '../core/textureExtent.ts'

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
        .flatMap(({ destination, data, layout, size }) => {
          const [x, y, layer] = destination.origin as number[],
            [width, lines] = textureExtent(size)
          // A write of the frame words is whole rows, from a row's start: never a word alone.
          if (x % FRAME_ROW_WORDS || width % FRAME_ROW_WORDS)
            throw new Error(`a frames write of ${width} words at ${x} is no whole rows`)
          const bytes = data as unknown as Uint8Array,
            rows: [number, Uint32Array][] = []
          for (let line = 0; line < lines; line++)
            for (let k = 0; k < width / FRAME_ROW_WORDS; k++) {
              const row =
                  (((layer << FRAME_TABLE.layerShift) + y + line) << FRAME_TABLE.rowShift) +
                  x / FRAME_ROW_WORDS +
                  k,
                from = (layout.offset ?? 0) + line * layout.bytesPerRow! + k * FRAME_ROW_WORDS * 4
              rows.push([
                row * FRAME_ROW_WORDS,
                new Uint32Array(bytes.slice(from, from + FRAME_ROW_WORDS * 4).buffer),
              ])
            }
          return rows
        }),
  }
}
