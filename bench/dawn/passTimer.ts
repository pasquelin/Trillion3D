// Every pass of every frame timed by the bench itself, by its label: a pass the engine does not
// time carries the bench's two timestamps, so the GPU time of the whole frame is read from the GPU
// — the union of its passes' spans, passes the GPU overlaps counted once — and never from a host
// clock a busy main thread would stretch. A pass the engine times keeps its own timestamps: a frame
// that holds one is marked, its total left out.
import { readPasses, type FrameGpu, type PassWork, type TimedPass } from './passSpans.ts'
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
        calls: 0,
        indirect: 0,
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
      if (wrapped) records.set(pass, passes[passes.length - 1])
    },
    /** Tallies what the pass `self` encodes (`countCalls`): work of some size, or indirect. */
    tally(self: object, indirect: boolean, size: number) {
      const record = records.get(self)
      if (record && (indirect || size > 0)) record[indirect ? 'indirect' : 'calls']++
    },
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

/** The calls of a pass encoder that do GPU work, by the arguments that give them a size: a direct
 *  call tallies when its size is above zero, an indirect one always. */
const CALLS: Record<string, [indirect: boolean, size: (args: number[]) => number]> = {
  dispatchWorkgroups: [false, ([x, y = 1, z = 1]) => x * y * z],
  dispatchWorkgroupsIndirect: [true, () => 1],
  draw: [false, ([vertices, instances = 1]) => vertices * instances],
  drawIndexed: [false, ([indices, instances = 1]) => indices * instances],
  drawIndirect: [true, () => 1],
  drawIndexedIndirect: [true, () => 1],
}

/** Makes every pass encoder of `globals` tell `timer` what it encodes, so a pass the driver wrote no
 *  timestamp for is known empty, or lost with work (`passSpans.ts`). */
export function countCalls(
  globals: Record<string, { prototype: Record<string, (...args: never[]) => unknown> }>,
  timer: Pick<ReturnType<typeof createPassTimer>, 'tally'>,
) {
  for (const encoder of ['GPUComputePassEncoder', 'GPURenderPassEncoder'] as const)
    for (const [name, [indirect, size]] of Object.entries(CALLS)) {
      const proto = globals[encoder].prototype
      const original = proto[name]
      if (!original) continue
      proto[name] = function (this: object, ...args: never[]) {
        timer.tally(this, indirect, size(args as unknown as number[]))
        return original.apply(this, args)
      }
    }
  const render = globals.GPURenderPassEncoder.prototype
  const bundles = render.executeBundles
  render.executeBundles = function (this: object, ...args: never[]) {
    timer.tally(this, false, (args[0] as unknown as unknown[]).length)
    return bundles.apply(this, args)
  }
}
