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
import type { GpuPassTiming, GpuPassTimings } from '../../../../sdk-core/src/index.ts'
import { nanosecondsToMs } from '../../gpu/timing/types.ts'
import { WHOLE_FRAME_PASS } from './wholeFramePass.ts'

/** Samples reread later: beyond this, the device cannot keep up and no more are opened. */
const MAX_PENDING = 4

type TimerExtension = {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

/** What a frame was drawn with, handed back with its duration. */
export type FrameTag = { scale: number; steered: boolean }
/** Names the passes of the frame being drawn; a call closes the previous one and opens the next. */
export type FramePass = (name: string) => void
/** A frame read back: its pass list, the sum of them and the image it timed; or why none. */
export type TimedFrame = {
  ms: number | null
  reason: string | null
  frame: number | null
  passes: GpuPassTiming[]
  truncated: boolean
  tag?: FrameTag
}
const none = (reason: string): TimedFrame => ({
  ms: null,
  reason,
  frame: null,
  passes: [],
  truncated: false,
})
/** The timed image as the frame metrics carry it (`GpuPassTimings`). */
export function webglPassSample(frame: number, read: TimedFrame): GpuPassTimings {
  return { frame, totalMs: read.ms, passes: read.passes, truncated: read.truncated }
}

export function createWebglFrameTimer(gl: WebGL2RenderingContext | null | undefined) {
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  const reason = 'EXT_disjoint_timer_query_webgl2 missing on this device'
  if (!gl || !ext)
    return {
      supported: false,
      reason,
      begin(_frame: number | null) {},
      pass(_name: string) {},
      end(_tag?: FrameTag) {},
      poll: () => none(reason),
    }
  type Query = { name: string; query: WebGLQuery }
  type Sample = { frame: number | null; tag?: FrameTag; queries: Query[]; truncated: boolean }
  let active: Sample | null = null
  let open: Query | null = null
  const pending: Sample[] = []
  /** Closes the open interval, if any, and gives it back to the sample. */
  const close = (sample: Sample) => {
    if (!open) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    sample.queries.push(open)
    open = null
  }
  /** Opens `name`'s interval, or marks the sample truncated when the device refuses a query. */
  const openQuery = (name: string) => {
    const query = gl.createQuery()
    if (!query) {
      if (active) active.truncated = true
      return
    }
    open = { name, query }
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
  }
  return {
    supported: true,
    reason: null as string | null,
    /** Opens the frame's one interval, unless the device is `MAX_PENDING` frames behind. */
    begin(frame: number | null) {
      // A frame whose `end` never came (its draw threw) leaves its interval open: close and
      // delete it here, or the next `beginQuery` runs on an active target and the query leaks.
      if (open) {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        gl.deleteQuery(open.query)
        open = null
      }
      for (const { query } of active?.queries ?? []) gl.deleteQuery(query)
      active = null
      if (pending.length >= MAX_PENDING) return
      active = { frame, queries: [], truncated: false }
      openQuery(WHOLE_FRAME_PASS)
    },
    /** Closes the pass in progress and opens `name`'s; one query open at a time, always. */
    pass(name: string) {
      if (!active) return
      if (open) {
        // The interval opened at `begin` becomes the first pass, so no gap is left unmeasured.
        if (!active.queries.length && open.name === WHOLE_FRAME_PASS) {
          open.name = name
          return
        }
        close(active)
      }
      openQuery(name)
    },
    end(tag?: FrameTag) {
      if (!active) return
      close(active)
      if (active.queries.length) {
        active.tag = tag
        pending.push(active)
        // Without on-screen present, the command stream can stay with the driver and the query
        // never become ready. `flush` pushes it without ever waiting — this is not a `finish`.
        gl.flush()
      }
      active = null
    },
    /** Pass durations of a past image and the image they name, or the reason none is publishable. */
    poll(): TimedFrame {
      if (!pending.length) return none('no pending query')
      const sample = pending[0]
      for (const { query } of sample.queries)
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
          return none('result not ready yet')
      pending.shift()
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
      const passes = sample.queries.map(({ name, query }): GpuPassTiming => {
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number
        gl.deleteQuery(query)
        if (disjoint) return { name, gpuMs: null, reason: 'GPU_DISJOINT_EXT' }
        if (!Number.isFinite(nanoseconds))
          return { name, gpuMs: null, reason: 'unreadable duration' }
        return { name, gpuMs: nanosecondsToMs(nanoseconds) }
      })
      if (disjoint) return none('the driver interrupted the measurement (GPU_DISJOINT_EXT)')
      // A truncated list has gaps, so neither its sum nor the envelope names a real duration.
      const measured = !sample.truncated && passes.every((pass) => pass.gpuMs !== null)
      const ms = measured ? passes.reduce((sum, pass) => sum + (pass.gpuMs ?? 0), 0) : null
      return {
        ms,
        reason: null,
        frame: sample.frame,
        passes,
        truncated: sample.truncated,
        tag: sample.tag,
      }
    },
  }
}
