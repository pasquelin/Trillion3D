/**
 * WebGL2 GPU timer: `EXT_disjoint_timer_query_webgl2`. Unlike WebGPU, WebGL2 cannot timestamp a
 * pass: it measures only a command interval. This engine submits the whole frame in one
 * `render`, so the measured interval is the whole frame — and that is what it reports, never
 * splitting that duration across steps it has not measured.
 *
 * The read never blocks: a query is reread a few frames later, and a query the driver marked
 * “disjoint” is dropped instead of being published.
 */
import { nanosecondsToMs } from './gpuTimingTypes.ts';

/** Queries reread later: beyond this, the device cannot keep up and no more are opened. */
const MAX_PENDING = 4;

type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  const reason = 'EXT_disjoint_timer_query_webgl2 missing on this device';
  if (!gl || !ext)
    return {
      supported: false,
      reason,
      begin() {},
      end() {},
      poll: () => ({ ms: null as number | null, reason }),
    };
  let open: WebGLQuery | null = null;
  const pending: WebGLQuery[] = [];
  return {
    supported: true,
    reason: null as string | null,
    /** Opens the interval; one query at a time, the spec does not allow two. */
    begin() {
      if (open || pending.length > MAX_PENDING) return;
      const query = gl.createQuery();
      if (!query) return;
      open = query;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
      // Without on-screen present, the command stream can stay with the driver and the query never
      // become ready. `flush` pushes it without ever waiting — this is not a `finish`.
      gl.flush();
    },
    /** Duration of a past frame, or the reason none is publishable. */
    poll(): { ms: number | null; reason: string | null } {
      if (!pending.length) return { ms: null, reason: 'no pending query' };
      const query = pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
        return { ms: null, reason: 'result not ready yet' };
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      if (disjoint)
        return { ms: null, reason: 'the driver interrupted the measurement (GPU_DISJOINT_EXT)' };
      if (!Number.isFinite(nanoseconds)) return { ms: null, reason: 'unreadable duration' };
      return { ms: nanosecondsToMs(nanoseconds), reason: null };
    },
  };
}
