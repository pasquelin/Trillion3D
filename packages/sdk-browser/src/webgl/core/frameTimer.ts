/**
 * WebGL2 GPU timer: `EXT_disjoint_timer_query_webgl2`. Unlike WebGPU, WebGL2 cannot timestamp a
 * pass: it measures only a command interval, one query at a time. The frame's contiguous passes
 * are therefore wrapped in their own query, in order, each closing where the next opens, and the
 * image publishes them as WebGPU's `gpuPassMs` does. A frame whose caller names no pass keeps one
 * implicit `frame` interval, so a draw path that has nothing to split still gets a duration.
 *
 * The read never blocks: a sample is reread a few frames later, and a query the driver marked
 * “disjoint” is dropped instead of being published. `end(tag)` carries what the frame was drawn
 * with — its render scale — to the durations that come back with it.
 */
import type { GpuPassTimings } from '../../../../sdk-core/src/index.ts';
import { nanosecondsToMs } from '../../gpu/timing/types.ts';

/** Samples reread later: beyond this, the device cannot keep up and no more are opened. */
const MAX_PENDING = 4;
/** The one pass of a frame whose caller names none. */
export const WHOLE_FRAME_PASS = 'Trillion3D WebGL2 frame';

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

/** What a frame was drawn with, handed back with its duration. */
export type FrameTag = { scale: number; steered: boolean };
/** Names the passes of the frame being drawn; a call closes the previous one and opens the next. */
export type FramePass = (name: string) => void;
/** One pass of a timed image, ready or with why not. */
export type FramePassTiming = { name: string; ms: number | null; reason?: string };
/** A frame read back: its pass list, the sum of them and the image it timed; or why none. */
export type TimedFrame = {
  ms: number | null;
  reason: string | null;
  frame: number | null;
  passes: FramePassTiming[];
  truncated: boolean;
  tag?: FrameTag;
};
const none = (reason: string): TimedFrame => ({
  ms: null,
  reason,
  frame: null,
  passes: [],
  truncated: false,
});
/** The timed image as the frame metrics carry it (`GpuPassTimings`). */
export function webglPassSample(frame: number, read: TimedFrame): GpuPassTimings {
  return {
    frame,
    totalMs: read.ms,
    passes: read.passes.map((pass) =>
      pass.reason === undefined
        ? { name: pass.name, gpuMs: pass.ms }
        : { name: pass.name, gpuMs: pass.ms, reason: pass.reason },
    ),
    truncated: read.truncated,
  };
}

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  const reason = 'EXT_disjoint_timer_query_webgl2 missing on this device';
  if (!gl || !ext)
    return {
      supported: false,
      reason,
      begin(_frame: number | null) {},
      pass(_name: string) {},
      end(_tag?: FrameTag) {},
      poll: () => none(reason),
    };
  type Query = { name: string; query: WebGLQuery };
  type Sample = { frame: number | null; tag?: FrameTag; queries: Query[]; truncated: boolean };
  let active: Sample | null = null;
  let open: Query | null = null;
  const pending: Sample[] = [];
  /** Closes the open interval, if any, and gives it back to the sample. */
  const close = (sample: Sample) => {
    if (!open) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    sample.queries.push(open);
    open = null;
  };
  return {
    supported: true,
    reason: null as string | null,
    /** Opens the frame's one interval, unless the device is `MAX_PENDING` frames behind. */
    begin(frame: number | null) {
      if (pending.length >= MAX_PENDING) {
        active = null;
        return;
      }
      const query = gl.createQuery();
      active = { frame, queries: [], truncated: !query };
      if (query) {
        open = { name: WHOLE_FRAME_PASS, query };
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }
    },
    /** Closes the pass in progress and opens `name`'s; one query open at a time, always. */
    pass(name: string) {
      if (!active) return;
      if (open) {
        // The interval opened at `begin` becomes the first pass, so no gap is left unmeasured.
        if (!active.queries.length && open.name === WHOLE_FRAME_PASS) {
          open.name = name;
          return;
        }
        close(active);
      }
      const query = gl.createQuery();
      if (!query) {
        active.truncated = true;
        return;
      }
      open = { name, query };
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    end(tag?: FrameTag) {
      if (!active) return;
      close(active);
      if (active.queries.length) {
        active.tag = tag;
        pending.push(active);
        // Without on-screen present, the command stream can stay with the driver and the query
        // never become ready. `flush` pushes it without ever waiting — this is not a `finish`.
        gl.flush();
      }
      active = null;
    },
    /** Pass durations of a past image and the image they name, or the reason none is publishable. */
    poll(): TimedFrame {
      if (!pending.length) return none('no pending query');
      const sample = pending[0];
      for (const { query } of sample.queries)
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
          return none('result not ready yet');
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const passes = sample.queries.map(({ name, query }): FramePassTiming => {
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        gl.deleteQuery(query);
        if (disjoint) return { name, ms: null, reason: 'GPU_DISJOINT_EXT' };
        if (!Number.isFinite(nanoseconds)) return { name, ms: null, reason: 'unreadable duration' };
        return { name, ms: nanosecondsToMs(nanoseconds) };
      });
      if (disjoint) return none('the driver interrupted the measurement (GPU_DISJOINT_EXT)');
      const measured = passes.every((pass) => pass.ms !== null);
      const ms = measured ? passes.reduce((sum, pass) => sum + (pass.ms ?? 0), 0) : null;
      return {
        ms,
        reason: null,
        frame: sample.frame,
        passes,
        truncated: sample.truncated,
        tag: sample.tag,
      };
    },
  };
}
