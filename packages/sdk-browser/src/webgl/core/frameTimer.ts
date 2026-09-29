/**
 * WebGL2 GPU timer: `EXT_disjoint_timer_query_webgl2`. Unlike WebGPU, WebGL2 cannot timestamp a
 * pass: it measures only a command interval. This engine submits the whole frame in one
 * `render`, so the measured interval is the whole frame — and that is what it reports, never
 * splitting that duration across steps it has not measured.
 *
 * The read never blocks: a query is reread a few frames later, and a query the driver marked
 * “disjoint” is dropped instead of being published. `end(tag)` carries what the frame was drawn
 * with — its render scale — to the duration that comes back with it.
 */
import { nanosecondsToMs } from '../../gpu/timing/types.ts';

/** Queries reread later: beyond this, the device cannot keep up and no more are opened. */
const MAX_PENDING = 4;

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

/** What a frame was drawn with, handed back with its duration. */
export type FrameTag = { scale: number; steered: boolean };
/** A duration read back, the image it timed and its tag; or, with no duration, why. */
type TimedFrame = {
  ms: number | null;
  reason: string | null;
  frame: number | null;
  tag?: FrameTag;
};
const none = (reason: string): TimedFrame => ({ ms: null, reason, frame: null });

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  const reason = 'EXT_disjoint_timer_query_webgl2 missing on this device';
  if (!gl || !ext)
    return {
      supported: false,
      reason,
      begin(_frame: number | null) {},
      end(_tag?: FrameTag) {},
      poll: () => none(reason),
    };
  let open: { query: WebGLQuery; frame: number | null } | null = null;
  const pending: { query: WebGLQuery; frame: number | null; tag?: FrameTag }[] = [];
  return {
    supported: true,
    reason: null as string | null,
    /** Opens the interval of image `frame` (`null`: an image no metric names, a held one put back);
     *  one query at a time, the spec does not allow two. */
    begin(frame: number | null) {
      if (open || pending.length > MAX_PENDING) return;
      const query = gl.createQuery();
      if (!query) return;
      open = { query, frame };
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    end(tag?: FrameTag) {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push({ ...open, tag });
      open = null;
      // Without on-screen present, the command stream can stay with the driver and the query never
      // become ready. `flush` pushes it without ever waiting — this is not a `finish`.
      gl.flush();
    },
    /** Duration of a past image and the image it names, or the reason none is publishable. */
    poll(): TimedFrame {
      if (!pending.length) return none('no pending query');
      const { query, frame, tag } = pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        return none('result not ready yet');
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (disjoint) return none('the driver interrupted the measurement (GPU_DISJOINT_EXT)');
      if (!Number.isFinite(nanoseconds)) return none('unreadable duration');
      return { ms: nanosecondsToMs(nanoseconds), reason: null, frame, tag };
    },
  };
}
