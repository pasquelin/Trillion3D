import { createExplorerFrameScheduler } from '../render/frameScheduler.ts'
import type { MeasuredWorldOptions } from './options.ts'
import type { createExplorerApi } from '../api/api.ts'
import type { SessionRuntime } from '../render/sessionRuntime.ts'
import type { ExplorerEmitters } from './session.ts'
import { interactiveResize, type ResizeWiring } from './interactiveResize.ts'

type Explorer = ReturnType<typeof createExplorerApi>

/** What the loop reads: the session, its explorer and window, the host's options, the failure. */
type LoopWiring = Omit<ResizeWiring, 'scheduler'>

/** Captures in flight: an image drawn meanwhile is refused (`SURFACE_CAPTURE_BUSY`), so the loop
 *  draws nothing and goes idle until the last one asks the view back. */
type Captures = { count: number }

/** The loop stops for good: said on the console too, or the canvas would freeze without a word,
 *  and reported to the page as an uncaught error is, so its own error watcher can name it. */
function reportFailure(view: Window, events: ExplorerEmitters, error: unknown) {
  console.error('[trillion3d] Automatic rendering stopped', error)
  view.reportError?.(error)
  events.emit({
    eventVersion: 1,
    type: 'fatal',
    audience: 'blocking',
    recovered: false,
    code: 'INTERACTIVE_RENDER_FAILED',
    detail: String(error),
  })
  events.diagnose('interactive-render-failed', 'Automatic rendering stopped', {
    error: String(error),
  })
}

/** The loop's frame scheduler on `view`: a frame draws the explorer unless a capture or a family
 *  is on its way, or the engine holds it to measure the display. */
function loopScheduler(loop: LoopWiring, captures: Captures, events: ExplorerEmitters) {
  const { view, runtime, explorer, original, fail } = loop
  return createExplorerFrameScheduler({
    request: view.requestAnimationFrame.bind(view),
    cancel: view.cancelAnimationFrame.bind(view),
    render: () => {
      // A frame that waits for a family on its way (`familyUse.ts`) is not drawn, nor stepped.
      if (captures.count || runtime.familiesPending()) return
      // Before its first image, a frame the engine holds to measure the display draws nothing.
      if (runtime.engine.measureFrame()) return
      original.beforeFrame?.()
      // Drawn whether or not the host listens: `onFrame?.(render())` would skip the render itself.
      const metrics = explorer.render()
      original.onFrame?.(metrics)
    },
    // A page landing, or a still image an unfinished average takes, is the image still arriving:
    // those frames spend none of the settle limit: the engine's own count.
    progress: () => runtime.engine.landings(),
    pending: () => (captures.count ? Promise.resolve(false) : runtime.pendingFrame()),
    error: fail,
    limited: () =>
      events.diagnose(
        'interactive-settle-limit',
        'Automatic rendering paused after 120 frames; invalidate to continue',
        { frames: 120 },
      ),
  })
}

/** A capture puts the view back without what frames build up (the effect chain, the temporal
 *  accumulation, the water): the loop draws it again once it is over, gone idle or not. */
function wrapCaptures(explorer: Explorer, captures: Captures, invalidate: () => void) {
  const aside = <T>(take: () => Promise<T>) => {
    captures.count++
    return new Promise<T>((taken) => taken(take())).finally(() => {
      captures.count--
      invalidate()
    })
  }
  const { captureView, captureSurfaceView } = explorer
  explorer.captureView = (width, height) => aside(() => captureView(width, height))
  explorer.captureSurfaceView = (pose, size) => aside(() => captureSurfaceView(pose, size))
}

/** Opt-in browser lifecycle. Manual sessions never install listeners or schedule a frame. */
export function startInteractiveExplorer(
  explorer: Explorer,
  runtime: SessionRuntime,
  original: MeasuredWorldOptions,
  events: ExplorerEmitters,
) {
  const { canvas, options, ownedControls } = runtime
  const view = canvas.ownerDocument.defaultView!
  const controls = original.ownControls === false ? undefined : explorer.controls()
  const fail = (error: unknown) => reportFailure(view, events, error)
  const captures: Captures = { count: 0 }
  const loop: LoopWiring = { original, runtime, explorer, view, fail }
  const scheduler = loopScheduler(loop, captures, events)
  const invalidate = scheduler.invalidate
  const resizing = interactiveResize({ ...loop, scheduler })
  const abort = () => explorer.dispose()
  ownedControls.push({
    dispose() {
      scheduler.dispose()
      resizing.dispose()
      controls?.removeEventListener('change', invalidate)
      options.signal?.removeEventListener('abort', abort)
    },
  })
  controls?.addEventListener('change', invalidate)
  resizing.watch()
  options.signal?.addEventListener('abort', abort, { once: true })
  options.signal?.throwIfAborted()
  resizing.resize()
  // Drawn whether or not the host listens: `onFrame?.(render())` would skip the render itself.
  if (!runtime.familiesPending()) {
    original.beforeFrame?.()
    const first = explorer.render()
    original.onFrame?.(first)
  }
  wrapCaptures(explorer, captures, invalidate)
  invalidate()
  return invalidate
}
