import { QUERY_SET_SIZE } from './querySetSize.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import type { ReadbackRing } from '../core/readbackRing.ts'
import type { TimingEntry } from './sample.ts'

/** A part's first query: its resolve lands at a 256-byte offset, 32 timestamps. */
export const PART_ALIGN = 32

/** Readbacks in flight at most: a sampled image's, and the next image's, read beside it so the
 *  idle between the two is measured (`timeline.ts`). */
export const READBACKS = 2

/** What an image's readback says of it, filled when the image closes (`closeImage.ts`): its frame,
 *  its passes, whether it was truncated, the bytes its timestamps take, its metadata. */
export type TimedRead = {
  frame: number
  entries: TimingEntry[]
  truncated: boolean
  used: number
  metadata: Record<string, unknown>
}

/** The timestamps' sets, their resolve buffer, and the ring an image's timestamps come back
 *  through, a buffer per image in flight (`closeImage.ts`, `timingReadbacks`). */
export type TimingResources = {
  sets: GPUQuerySet[]
  resolve: GPUBuffer
  readbacks: ReadbackRing<TimedRead>
}

/** Allocate the queries together — `queryCount` timestamps over as many sets as they take, and the
 *  buffer they resolve into —; a failed allocation releases every earlier one. */
export function createTimingQueries(device: GPUDevice, queryCount: number) {
  const made: Array<GPUQuerySet | GPUBuffer> = []
  try {
    const bytes = queryCount * 8,
      sets: GPUQuerySet[] = []
    for (let first = 0; first < queryCount; first += QUERY_SET_SIZE) {
      const count = Math.min(QUERY_SET_SIZE, queryCount - first)
      const set = device.createQuerySet({ type: 'timestamp', count })
      made.push(set)
      sets.push(set)
    }
    const resolve = device.createBuffer({
      label: 'Trillion3D timestamp resolve',
      size: bytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    })
    made.push(resolve)
    return { sets, resolve }
  } catch (error) {
    for (const resource of made) resource.destroy()
    throw error
  }
}

/** One encoder of the image: its first timestamp, once it timed a pass, and its passes' names. */
export type TimingPart = { slot: number; base: number; names: string[]; resolved: boolean }
/** The image's timestamps: the next free one, the part that took the last, and the readback its
 *  parts copy into, under what it says of the image (`tag`). */
export type TimingImage = {
  truncated: boolean
  cursor: number
  latest?: TimingPart
  read: GPUBuffer
  tag: TimedRead
}

/**
 * Attach timestamp writes to every pass and resolve them when the encoder finishes. The image's
 * parts take their timestamps one after the other from one range of `queryCount`: a part's run
 * from its first pass, while no later part took any. A pass past the range, or of a part another
 * one followed, is not timed and the image says it is truncated.
 */
export function instrumentTimingEncoder(
  encoder: GPUCommandEncoder,
  part: TimingPart,
  image: TimingImage,
  resources: TimingResources,
  queryCount: number,
): GPUCommandEncoder {
  const { sets, resolve } = resources
  return new Proxy(encoder, {
    get(target, key) {
      if (key === 'beginRenderPass' || key === 'beginComputePass')
        return (descriptor: GPURenderPassDescriptor | GPUComputePassDescriptor = {}) => {
          let instrumented = descriptor
          if (part.base < 0) {
            part.base = alignUp(image.cursor, PART_ALIGN)
            image.latest = part
          }
          const index = part.base + part.names.length * 2
          if (image.latest === part && index + 2 <= queryCount && !descriptor.timestampWrites) {
            part.names.push(descriptor.label ?? String(key))
            image.cursor = index + 2
            const local = index % QUERY_SET_SIZE
            instrumented = {
              ...descriptor,
              timestampWrites: {
                querySet: sets[Math.floor(index / QUERY_SET_SIZE)],
                beginningOfPassWriteIndex: local,
                endOfPassWriteIndex: local + 1,
              },
            }
          } else image.truncated = true
          return key === 'beginRenderPass'
            ? target.beginRenderPass(instrumented as GPURenderPassDescriptor)
            : target.beginComputePass(instrumented)
        }
      if (key === 'finish')
        return (descriptor?: GPUCommandBufferDescriptor) => {
          if (part.names.length) {
            const end = part.base + part.names.length * 2
            // A set boundary is a multiple of the alignment: each chunk resolves at its own offset.
            for (let at = part.base; at < end;) {
              const set = Math.floor(at / QUERY_SET_SIZE),
                stop = Math.min(end, (set + 1) * QUERY_SET_SIZE)
              target.resolveQuerySet(sets[set], at % QUERY_SET_SIZE, stop - at, resolve, at * 8)
              at = stop
            }
            target.copyBufferToBuffer(
              resolve,
              part.base * 8,
              image.read,
              part.base * 8,
              (end - part.base) * 8,
            )
            part.resolved = true
          }
          return target.finish(descriptor)
        }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
