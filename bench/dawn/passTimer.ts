// Every pass of every frame timed by the bench itself, by its label: a pass the engine does not
// time carries the bench's two timestamps, so the GPU time of the whole frame is read from the GPU
// — the union of its passes' spans, passes the GPU overlaps counted once — and never from a host
// clock a busy main thread would stretch. A pass the engine times keeps its own timestamps: a frame
// that holds one is marked, its total left out.
import { readPasses, type FrameGpu, type TimedPass } from './passSpans.ts'
import { attachmentBytes, emptyWork, type PassWork } from './passWorkHooks.ts'
import { readBack } from './readBack.ts'

/** Timestamps of one frame: two per pass. */
const CAPACITY = 4096

/** The pass timer of one device; `quiet` runs the bench's own commands uncounted. */
export function createPassTimer(quiet: <T>(work: () => T) => T) {
  let device: GPUDevice | null = null,
    set: GPUQuerySet | null = null,
    resolved: GPUBuffer | null = null,
    read: GPUBuffer | null = null,
    open = false,
    slot = 0,
    engineTimed = false
  const passes: ({ label: string; kind: TimedPass['kind']; at: number } & PassWork)[] = []
  /** The pass encoders being tallied, by the record of the pass they run. */
  const records = new WeakMap<object, PassWork>()
  const labels = new WeakMap<object, string>()
  return {
    /** The descriptor a pass begins with: the engine's own, with the bench's timestamps added
     *  when it carries none — a copy, so a descriptor the engine keeps is never changed. */
    wrap<D extends GPURenderPassDescriptor | GPUComputePassDescriptor | undefined>(
      kind: TimedPass['kind'],
      descriptor: D,
      encoderLabel: string,
    ): D {
      if (!open || !set) return descriptor
      if (descriptor?.timestampWrites) {
        engineTimed = true
        return descriptor
      }
      if (slot + 2 > CAPACITY) return descriptor
      const at = slot
      slot += 2
      passes.push({
        label: descriptor?.label || encoderLabel || `(${kind} pass)`,
        kind,
        at,
        ...emptyWork(),
        attachBytes: kind === 'render' ? attachmentBytes(descriptor as GPURenderPassDescriptor) : 0,
      })
      const timestampWrites = {
        querySet: set,
        beginningOfPassWriteIndex: at,
        endOfPassWriteIndex: at + 1,
      }
      return { ...descriptor, timestampWrites } as D
    },
    /** How many passes this window holds. */
    size: () => passes.length,
    /** The pass encoder just made for the descriptor `wrap` answered: its calls are tallied. */
    watch(pass: object, wrapped: boolean) {
      if (!wrapped) return
      records.set(pass, passes[passes.length - 1])
      labels.set(pass, passes[passes.length - 1].label)
    },
    /** The work record of a pass this timer follows. */
    recordOf: (pass: object) => records.get(pass),
    /** The label a followed pass was begun with. */
    labelOf: (pass: object) => labels.get(pass),
    /** Opens a frame's window on `on`, the device the engine draws with. */
    open(on: GPUDevice) {
      if (device !== on)
        quiet(() => {
          device = on
          set = on.createQuerySet({ type: 'timestamp', count: CAPACITY })
          resolved = on.createBuffer({
            size: CAPACITY * 8,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          })
          read = on.createBuffer({
            size: CAPACITY * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          })
        })
      open = true
      slot = 0
      engineTimed = false
      passes.length = 0
    },
    /** Closes the window once everything it encoded was submitted: reads its timestamps back. */
    async close(): Promise<FrameGpu | null> {
      open = false
      if (!device || !set || !read || !resolved) return null
      if (!slot) return { passes: [], unionMs: 0, gapMs: 0, windowMs: 0, complete: !engineTimed }
      const [s, r, from, count] = [set, read, resolved, slot]
      const stamps = new BigInt64Array(
        await readBack({ quiet }, device, r, count * 8, (encoder) => {
          encoder.resolveQuerySet(s, 0, count, from, 0)
          encoder.copyBufferToBuffer(from, 0, r, 0, count * 8)
        }),
      )
      return readPasses(stamps, passes, !engineTimed)
    },
  }
}
