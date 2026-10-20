import { createExplorerFrameScheduler } from '../frame/schedule/frameScheduler.ts'
import type { MeasuredWorldOptions } from './options.ts'
import type { createExplorerApi } from '../api/api.ts'
import type { SessionRuntime } from '../frame/schedule/sessionRuntime.ts'
import { sayFatal, type ExplorerEmitters } from './session.ts'
import { canvasFollower, interactiveResize, type ResizeWiring } from './interactiveResize.ts'

type Explorer = ReturnType<typeof createExplorerApi>

/** What the loop reads: the session, its explorer and window, the host's options, the failure. */
type LoopWiring = Omit<ResizeWiring, 'scheduler'>

/** Captures in flight: an image drawn meanwhile is refused (`SURFACE_CAPTURE_BUSY`), so the loop
 *  draws nothing until the last one asks the view back. */
type Captures = { count: number }

/** The loop stops for good: said on the console too, or the canvas would freeze without a word,
 *  and reported to the page as an uncaught error is, so its own error watcher can name it. */
function reportFailure(view: Window, events: ExplorerEmitters, error: unknown) {
  console.error('[trillion3d] Automatic rendering stopped', error)
  view.reportError?.(error)
  sayFatal(events, 'INTERACTIVE_RENDER_FAILED', String(error), {
    phase: 'interactive-render-failed',
    message: 'Automatic rendering stopped',
    context: { error: String(error) },
  })
}

/** The loop's frame scheduler on `view`: a frame draws the explorer unless a capture or a family
 *  is on its way, or the engine holds it to measure the display. */
/** Whether the loop holds its frame: a capture in flight, or a family the frame draws with on its
 *  way (`familyUse.ts`): not drawn, nor stepped. */
const held = (runtime: SessionRuntime, captures: Captures) =>
  captures.count > 0 || !!runtime.familiesPending()

/** One frame of the loop: the host's prologue, the draw, the host's epilogue. Drawn whether or not
 *  the host listens: `onFrame?.(render())` would skip the render itself. */
function drawFrame({ explorer, original }: LoopWiring) {
  original.beforeFrame?.()
  const metrics = explorer.render()
  original.onFrame?.(metrics)
}

function loopScheduler(loop: LoopWiring, captures: Captures) {
  const { view, runtime, fail } = loop
  return createExplorerFrameScheduler({
    request: view.requestAnimationFrame.bind(view),
    cancel: view.cancelAnimationFrame.bind(view),
    render: () => {
      if (held(runtime, captures)) return
      // Before its first image, a frame the engine holds to measure the display draws nothing.
      if (!runtime.engine.measureFrame()) drawFrame(loop)
    },
    // A display frame the engine's frame cap leaves out draws and counts nothing. A frame that
    // would not draw anyway — a capture, a family on its way — is not the engine's to leave out.
    skip: () => !held(runtime, captures) && runtime.engine.skipsFrame(),
    pending: () => (captures.count ? Promise.resolve(false) : runtime.pendingFrame()),
    error: fail,
  })
}

/** A capture puts the view back without what frames build up (the effect chain, the temporal
 *  accumulation, the water): the loop draws it again once it is over. */
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
  follow = canvasFollower(runtime, explorer, original),
) {
  const { canvas, options, ownedControls } = runtime
  const view = canvas.ownerDocument.defaultView!
  const fail = (error: unknown) => reportFailure(view, events, error)
  const captures: Captures = { count: 0 }
  const loop: LoopWiring = { original, runtime, explorer, view, fail }
  const scheduler = loopScheduler(loop, captures)
  const invalidate = scheduler.invalidate
  const resizing = interactiveResize({ ...loop, scheduler }, follow)
  const abort = () => explorer.dispose()
  ownedControls.push({
    dispose() {
      scheduler.dispose()
      resizing.dispose()
      options.signal?.removeEventListener('abort', abort)
    },
  })
  resizing.watch()
  options.signal?.addEventListener('abort', abort, { once: true })
  options.signal?.throwIfAborted()
  resizing.resize()
  if (!held(runtime, captures)) drawFrame(loop)
  wrapCaptures(explorer, captures, invalidate)
  invalidate()
  return invalidate
}
