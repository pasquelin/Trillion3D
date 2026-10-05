// Every pass of every frame timed by the bench itself, by its label: a pass the engine does not
// time carries the bench's two timestamps, so the GPU time of the whole frame is read from the GPU
// — the union of its passes' spans, passes the GPU overlaps counted once — and never from a host
// clock a busy main thread would stretch. A pass the engine times keeps its own timestamps: a frame
// that holds one is marked, its total left out.
import { readBack } from './readBack.ts';

/** Timestamps of one frame: two per pass. */
const CAPACITY = 4096;

/** One timed pass of a frame: `ms` its own share of the frame's GPU time. */
export type TimedPass = { label: string; kind: 'render' | 'compute'; ms: number };
/** A frame's passes and their union, ms; `complete` false when the engine timed one of them. */
export type FrameGpu = { passes: TimedPass[]; unionMs: number; complete: boolean };

/** The union of `[begin, end]` spans, in their unit. */
export function unionOf(spans: readonly [number, number][]) {
  let total = 0,
    reach = -Infinity;
  for (const [begin, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (end <= reach) continue;
    total += end - Math.max(begin, reach);
    reach = end;
  }
  return total;
}

/** The pass timer of one device; `quiet` runs the bench's own commands uncounted. */
export function createPassTimer(quiet: <T>(work: () => T) => T) {
  let device: GPUDevice | null = null,
    set: GPUQuerySet | null = null,
    resolved: GPUBuffer | null = null,
    read: GPUBuffer | null = null,
    open = false,
    slot = 0,
    engineTimed = false;
  const passes: { label: string; kind: TimedPass['kind']; at: number }[] = [];
  return {
    /** The descriptor a pass begins with: the engine's own, with the bench's timestamps added
     *  when it carries none — a copy, so a descriptor the engine keeps is never changed. */
    wrap<D extends GPURenderPassDescriptor | GPUComputePassDescriptor | undefined>(
      kind: TimedPass['kind'],
      descriptor: D,
      encoderLabel: string,
    ): D {
      if (!open || !set) return descriptor;
      if (descriptor?.timestampWrites) {
        engineTimed = true;
        return descriptor;
      }
      if (slot + 2 > CAPACITY) return descriptor;
      const at = slot;
      slot += 2;
      passes.push({ label: descriptor?.label || encoderLabel || `(${kind} pass)`, kind, at });
      const timestampWrites = {
        querySet: set,
        beginningOfPassWriteIndex: at,
        endOfPassWriteIndex: at + 1,
      };
      return { ...descriptor, timestampWrites } as D;
    },
    /** Opens a frame's window on `on`, the device the engine draws with. */
    open(on: GPUDevice) {
      if (device !== on)
        quiet(() => {
          device = on;
          set = on.createQuerySet({ type: 'timestamp', count: CAPACITY });
          resolved = on.createBuffer({
            size: CAPACITY * 8,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          });
          read = on.createBuffer({
            size: CAPACITY * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          });
        });
      open = true;
      slot = 0;
      engineTimed = false;
      passes.length = 0;
    },
    /** Closes the window once everything it encoded was submitted: reads its timestamps back. */
    async close(): Promise<FrameGpu | null> {
      open = false;
      if (!device || !set || !read || !resolved) return null;
      if (!slot) return { passes: [], unionMs: 0, complete: !engineTimed };
      const [s, r, from, count] = [set, read, resolved, slot];
      const stamps = new BigInt64Array(
        await readBack({ quiet }, device, r, count * 8, (encoder) => {
          encoder.resolveQuerySet(s, 0, count, from, 0);
          encoder.copyBufferToBuffer(from, 0, r, 0, count * 8);
        }),
      );
      // A pass's own share: its span less what a pass submitted before it already covered — a
      // tiled GPU runs passes overlapped, each span holding its neighbours' (the engine's own
      // rule, `gpu/timing/sample.ts`). The shares add up to the union.
      const spans: [number, number][] = [];
      let covered = -Infinity;
      const timed = passes.map(({ label, kind, at }) => {
        const begin = Number(stamps[at]) / 1e6,
          end = Number(stamps[at + 1]) / 1e6;
        // A pass the driver skipped writes no timestamp: zero, or an end before its beginning.
        if (!(stamps[at] > 0n && end >= begin)) return { label, kind, ms: 0 };
        spans.push([begin, end]);
        const own = Math.max(0, end - Math.max(begin, covered));
        covered = Math.max(covered, end);
        return { label, kind, ms: own };
      });
      return { passes: timed, unionMs: unionOf(spans), complete: !engineTimed };
    },
  };
}
