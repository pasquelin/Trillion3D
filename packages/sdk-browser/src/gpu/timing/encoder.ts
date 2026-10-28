import { QUERY_SET_SIZE } from './querySetSize.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import type { ReadbackRing } from '../core/readbackRing.ts'
import type { TimingEntry } from './sample.ts'
import { TIMED_ENCODER } from '../core/timedEncoder.ts'

/** A part's first query: its resolve lands at a 256-byte offset, 32 timestamps. */
export const PART_ALIGN = 32

/** Readbacks in flight at most: a sampled image's, and the next image's, read beside it so the
 *  idle between the two is measured (`timeline.ts`). */
export const READBACKS = 2

/** What an image's readback says of it, filled when the image closes (`closeImage.ts`): its frame,
 *  its passes, the bytes its timestamps take, and its metadata. */
export type TimedRead = {
  frame: number
  entries: TimingEntry[]
  used: number
  metadata: Record<string, unknown>
}

/** The timestamps' sets, the buffer they resolve through, and the ring an image's timestamps come
 *  back through, a buffer per image in flight (`closeImage.ts`, `timingReadbacks`). The timer holds `capacity`
 *  timestamps, `sets` of `QUERY_SET_SIZE` each; it grows between images (`requestGrowth`). */
export type TimingResources = {
  sets: GPUQuerySet[]
  capacity: number
  resolve: GPUBuffer
  readbacks: ReadbackRing<TimedRead>
  /** A growth is being validated (`requestGrowth`); false once the timer is given up. */
  growing: boolean
  alive: boolean
}

/** Allocate the queries together — `queryCount` timestamps over as many sets as they take, and the
 *  buffer they resolve into —; a failed allocation releases every earlier one. */
export function createTimingQueries(device: GPUDevice, queryCount: number) {
  const made: Array<GPUQuerySet | GPUBuffer> = []
  try {
    const sets: GPUQuerySet[] = []
    for (let first = 0; first < queryCount; first += QUERY_SET_SIZE) {
      const count = Math.min(QUERY_SET_SIZE, queryCount - first)
      const set = device.createQuerySet({ type: 'timestamp', count })
      made.push(set)
      sets.push(set)
    }
    const resolve = resolveBuffer(device, queryCount)
    made.push(resolve)
    return { sets, resolve, capacity: queryCount, growing: false, alive: true }
  } catch (error) {
    for (const resource of made) resource.destroy()
    throw error
  }
}

const resolveBuffer = (device: GPUDevice, queryCount: number) =>
  device.createBuffer({
    label: 'Trillion3D timestamp resolve',
    size: queryCount * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  })

/** One encoder of the image: the timestamp each of its timed passes begins at, their names, and
 *  its place among the image's submissions once it finished (`order`, -1 before). */
export type TimingPart = { at: number[]; names: string[]; order: number; resolved: boolean }
/** The image's timestamps: the next free one, the part that took the last, the parts finished so
 *  far, the ring buffer its parts copy into (`read`, from timestamp 0, `limit` timestamps), and what it says of the image (`tag`). */
export type TimingImage = {
  cursor: number
  /** Set when the image needed more timestamps than the timer holds: it is not timed (`closeTimedImage`). */
  overflowed?: boolean
  latest?: TimingPart
  finished: number
  read: GPUBuffer
  limit: number
  tag: TimedRead
}

/** The most timestamps a timer grows to: sixteen sets. An image that needs more is not timed (`TimingImage.overflowed`). */
export const MAX_QUERIES = 16 * QUERY_SET_SIZE

/**
 * Asks the timer to hold `need` timestamps: it doubles — more sets, a larger resolve buffer — until it does. The allocations are
 * WebGPU's, which fail asynchronously (an invalid object, not a throw): they are made under error scopes and the timer takes them
 * only once the scopes came back clean, for the images that follow; the image that asked is not timed (`TimingImage.overflowed`).
 * A refused growth leaves the timer as it was and is asked again by the next image that needs it. The resolve buffer it replaces is
 * given up when the work submitted so far is done, which may still read it.
 */
function requestGrowth(device: GPUDevice, resources: TimingResources, need: number) {
  if (resources.growing || need > MAX_QUERIES) return
  const was = resources.capacity
  let capacity = was
  while (capacity < need) capacity *= 2
  resources.growing = true
  const made: Array<GPUQuerySet | GPUBuffer> = []
  const sets: GPUQuerySet[] = []
  device.pushErrorScope('out-of-memory')
  device.pushErrorScope('validation')
  let resolve: GPUBuffer | undefined
  try {
    for (let first = was; first < capacity; first += QUERY_SET_SIZE) {
      const set = device.createQuerySet({ type: 'timestamp', count: QUERY_SET_SIZE })
      made.push(set)
      sets.push(set)
    }
    resolve = resolveBuffer(device, capacity)
    made.push(resolve)
  } catch {
    // A synchronous refusal: the scopes below still close.
  }
  const closed = [device.popErrorScope(), device.popErrorScope()]
  void Promise.all(closed).then(
    (errors) => {
      resources.growing = false
      if (!resolve || errors.some(Boolean) || !resources.alive) {
        for (const resource of made) resource.destroy()
        return
      }
      const old = resources.resolve
      resources.sets.push(...sets)
      resources.resolve = resolve
      resources.capacity = capacity
      void device.queue.onSubmittedWorkDone().then(() => old.destroy())
    },
    () => {
      resources.growing = false
      for (const resource of made) resource.destroy()
    },
  )
}

/** `descriptor` with the timestamps of the image's next free range written at its begin and end, as
 *  the part's pass `key` takes them; unchanged where the pass carries timestamps of its own. */
function timedDescriptor<D extends GPURenderPassDescriptor | GPUComputePassDescriptor>(
  descriptor: D,
  key: string | symbol,
  part: TimingPart,
  image: TimingImage,
  resources: TimingResources,
  device: GPUDevice,
): D {
  if (descriptor.timestampWrites) return descriptor
  const index = image.latest === part ? image.cursor : alignUp(image.cursor, PART_ALIGN)
  if (image.overflowed) return descriptor
  // Room is what the timer holds and what this image's ring buffer covers: a timer grown meanwhile is for the images that follow.
  if (index + 2 > Math.min(resources.capacity, image.limit)) {
    requestGrowth(device, resources, index + 2)
    image.overflowed = true
    return descriptor
  }
  part.at.push(index)
  part.names.push(descriptor.label ?? String(key))
  image.cursor = index + 2
  image.latest = part
  const local = index % QUERY_SET_SIZE
  return {
    ...descriptor,
    timestampWrites: {
      querySet: resources.sets[Math.floor(index / QUERY_SET_SIZE)],
      beginningOfPassWriteIndex: local,
      endOfPassWriteIndex: local + 1,
    },
  } as D
}

/** Timestamps `[begin, end)` resolved and copied into the image's ring buffer, from `target`. A set boundary is a multiple of the
 *  alignment: each chunk resolves at its own offset. */
function resolveRun(
  target: GPUCommandEncoder,
  image: TimingImage,
  { sets, resolve }: TimingResources,
  begin: number,
  end: number,
) {
  for (let at = begin; at < end;) {
    const set = Math.floor(at / QUERY_SET_SIZE),
      stop = Math.min(end, (set + 1) * QUERY_SET_SIZE)
    target.resolveQuerySet(sets[set], at % QUERY_SET_SIZE, stop - at, resolve, at * 8)
    at = stop
  }
  target.copyBufferToBuffer(resolve, begin * 8, image.read, begin * 8, (end - begin) * 8)
}

/** The part's timestamps resolved, in runs of consecutive ones, as its encoder finishes. */
function resolveParts(
  target: GPUCommandEncoder,
  part: TimingPart,
  image: TimingImage,
  resources: TimingResources,
) {
  const { at } = part
  for (let first = 0; first < at.length;) {
    let last = first
    while (last + 1 < at.length && at[last + 1] === at[last] + 2) last++
    resolveRun(target, image, resources, at[first], at[last] + 2)
    first = last + 1
  }
  if (at.length) part.resolved = true
  part.order = image.finished++
}

/**
 * Attach timestamp writes to every pass and resolve them when the encoder finishes. The image's
 * parts take their timestamps one after the other from one range: a pass follows
 * its part's last one while no other part took any since, and opens a run of its own at the next
 * aligned timestamp otherwise — a command buffer encoded and submitted while another is open (the
 * roots' before a cut, `../../placement/roots/rootPasses.ts`) is timed beside it. Every encoder of the image is a part, and
 * every pass is timed: the range grows as the images need (`requestGrowth`), up to `MAX_QUERIES`. A part's place among the
 * image's submissions is the order it finishes in, as every part is submitted once finished.
 */
export function instrumentTimingEncoder(
  encoder: GPUCommandEncoder,
  part: TimingPart,
  image: TimingImage,
  resources: TimingResources,
  device: GPUDevice,
): GPUCommandEncoder {
  return new Proxy(encoder, {
    get(target, key) {
      if (key === TIMED_ENCODER) return true
      if (key === 'beginRenderPass')
        return (descriptor = {} as GPURenderPassDescriptor) =>
          target.beginRenderPass(timedDescriptor(descriptor, key, part, image, resources, device))
      if (key === 'beginComputePass')
        return (descriptor: GPUComputePassDescriptor = {}) =>
          target.beginComputePass(timedDescriptor(descriptor, key, part, image, resources, device))
      if (key === 'finish')
        return (descriptor?: GPUCommandBufferDescriptor) => {
          resolveParts(target, part, image, resources)
          return target.finish(descriptor)
        }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
