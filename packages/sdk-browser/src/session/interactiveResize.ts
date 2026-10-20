import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { createExplorerFrameScheduler } from '../frame/schedule/frameScheduler.ts'
import { interactiveSize } from './interactiveOptions.ts'
import type { MeasuredWorldOptions } from './options.ts'
import type { createExplorerApi } from '../api/api.ts'
import type { SessionRuntime } from '../frame/schedule/sessionRuntime.ts'

/** What the interactive loop's resizing reads and drives: the host's options, the session, its
 *  explorer and window, the loop, and what a failure stops (`interactive.ts`). */
export type ResizeWiring = {
  original: MeasuredWorldOptions
  runtime: SessionRuntime
  explorer: ReturnType<typeof createExplorerApi>
  view: Window
  scheduler: ReturnType<typeof createExplorerFrameScheduler>
  fail: (error: unknown) => void
}

/** Whether the canvas's CSS box is hidden on an axis its drawing buffer follows: it then keeps its
 *  last image until the box becomes visible again. */
const hidden = (canvas: HTMLCanvasElement, original: MeasuredWorldOptions) =>
  (!original.width && canvas.clientWidth < 1) || (!original.height && canvas.clientHeight < 1)

/**
 * THE ONE FOLLOWER OF THE CANVAS'S SIZE, whoever leads the frames: it measures the CSS box and the
 * display's ratio (`interactiveSize`) and, when they changed since its last measure, brings the
 * drawing buffer — and the camera's aspect — to them; true when it did. The session's own loop
 * calls it from its listeners (`interactiveResize`), a world its page leads before each frame it
 * draws. A size set by hand (`resize`) holds until the box itself changes.
 */
export function canvasFollower(
  runtime: Pick<SessionRuntime, 'canvas' | 'options' | 'state'>,
  explorer: Pick<ReturnType<typeof createExplorerApi>, 'resize'>,
  original: MeasuredWorldOptions,
) {
  const { canvas, options, state } = runtime
  let last = { width: options.width, height: options.height, pixelRatio: options.pixelRatio }
  return () => {
    if (state.disposed || hidden(canvas, original)) return false
    const size = interactiveSize(canvas, original)
    if (
      size.width === last.width &&
      size.height === last.height &&
      size.pixelRatio === last.pixelRatio
    )
      return false
    last = size
    Object.assign(options, size)
    explorer.resize(size.width, size.height)
    if (
      (original.width === undefined && Math.floor(canvas.clientWidth) !== size.width) ||
      (original.height === undefined && Math.floor(canvas.clientHeight) !== size.height)
    )
      throw new EngineError(
        'INVALID_CANVAS_LAYOUT',
        'Set canvas CSS width and height independently of its drawing buffer',
      )
    return true
  }
}

/** The session's own loop follows the canvas (`follow`): `resize` follows it once, `watch`
 *  listens to the box, the window and the ratio, `dispose` stops listening. A listener's failure
 *  stops the loop (`fail`). */
export function interactiveResize(wiring: ResizeWiring, follow: () => boolean) {
  const { original, runtime, view, scheduler, fail } = wiring,
    { canvas } = runtime
  let observer: ResizeObserver | undefined, media: MediaQueryList | undefined
  const resize = () => {
    if (follow()) scheduler.invalidate()
  }
  const resizeSafely = () => {
    try {
      resize()
    } catch (error) {
      scheduler.dispose()
      fail(error)
    }
  }
  const watchDpr = () => {
    media?.removeEventListener('change', dprChanged)
    if (original.pixelRatio !== undefined) return
    media = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`)
    media.addEventListener('change', dprChanged)
  }
  function dprChanged() {
    resizeSafely()
    watchDpr()
  }
  return {
    resize,
    watch() {
      if (
        typeof ResizeObserver !== 'undefined' &&
        (original.width === undefined || original.height === undefined)
      ) {
        observer = new ResizeObserver(resizeSafely)
        observer.observe(canvas)
      }
      view.addEventListener('resize', resizeSafely)
      watchDpr()
    },
    dispose() {
      observer?.disconnect()
      media?.removeEventListener('change', dprChanged)
      view.removeEventListener('resize', resizeSafely)
    },
  }
}
