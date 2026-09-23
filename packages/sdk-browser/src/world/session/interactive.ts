import { EngineError } from '../../../../sdk-core/src/index.ts';
import { createExplorerFrameScheduler } from '../render/frameScheduler.ts';
import { interactiveSize } from './interactiveOptions.ts';
import type { MeasuredWorldOptions } from './options.ts';
import type { createExplorerApi } from '../api/api.ts';
import type { ExplorerRuntimeSurface } from '../render/hostRuntime.ts';
import type { ExplorerEmitters } from './session.ts';

/** Opt-in browser lifecycle. Manual sessions never install listeners or schedule a frame. */
export function startInteractiveExplorer(
  explorer: ReturnType<typeof createExplorerApi>,
  runtime: ExplorerRuntimeSurface,
  original: MeasuredWorldOptions,
  events: ExplorerEmitters,
) {
  const { canvas, options, hostedControls, state } = runtime;
  const view = canvas.ownerDocument.defaultView!;
  const controls = original.ownControls === false ? undefined : explorer.controls();
  const reportFailure = (error: unknown) => {
    events.emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'INTERACTIVE_RENDER_FAILED',
      detail: String(error),
    });
    events.diagnose('interactive-render-failed', 'Automatic rendering stopped', {
      error: String(error),
    });
  };
  const scheduler = createExplorerFrameScheduler({
    request: view.requestAnimationFrame.bind(view),
    cancel: view.cancelAnimationFrame.bind(view),
    render: () => {
      original.beforeFrame?.();
      const metrics = explorer.render();
      original.onFrame?.(metrics);
    },
    pending: runtime.pendingFrame,
    error: reportFailure,
    limited: () =>
      events.diagnose(
        'interactive-settle-limit',
        'Automatic rendering paused after 120 frames; invalidate to continue',
        { frames: 120 },
      ),
  });
  const invalidate = scheduler.invalidate;
  let observer: ResizeObserver | undefined, media: MediaQueryList | undefined;
  const resize = () => {
    if (state.disposed) return;
    // A hidden canvas keeps its last image until its CSS box becomes visible again.
    if (
      (!original.width && canvas.clientWidth < 1) ||
      (!original.height && canvas.clientHeight < 1)
    )
      return;
    const size = interactiveSize(canvas, original);
    if (
      size.width === options.width &&
      size.height === options.height &&
      size.pixelRatio === options.pixelRatio
    )
      return;
    Object.assign(options, size);
    explorer.resize(size.width, size.height);
    if (
      (original.width === undefined && Math.floor(canvas.clientWidth) !== size.width) ||
      (original.height === undefined && Math.floor(canvas.clientHeight) !== size.height)
    )
      throw new EngineError(
        'INVALID_CANVAS_LAYOUT',
        'Set canvas CSS width and height independently of its drawing buffer',
      );
    invalidate();
  };
  const resizeSafely = () => {
    try {
      resize();
    } catch (error) {
      scheduler.dispose();
      reportFailure(error);
    }
  };
  const watchDpr = () => {
    media?.removeEventListener('change', dprChanged);
    if (original.pixelRatio !== undefined) return;
    media = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
    media.addEventListener('change', dprChanged);
  };
  function dprChanged() {
    resizeSafely();
    watchDpr();
  }
  const abort = () => explorer.dispose();
  hostedControls.push({
    dispose() {
      scheduler.dispose();
      observer?.disconnect();
      media?.removeEventListener('change', dprChanged);
      view.removeEventListener('resize', resizeSafely);
      controls?.removeEventListener('change', invalidate);
      options.signal?.removeEventListener('abort', abort);
    },
  });
  controls?.addEventListener('change', invalidate);
  if (
    typeof ResizeObserver !== 'undefined' &&
    (original.width === undefined || original.height === undefined)
  ) {
    observer = new ResizeObserver(resizeSafely);
    observer.observe(canvas);
  }
  view.addEventListener('resize', resizeSafely);
  watchDpr();
  options.signal?.addEventListener('abort', abort, { once: true });
  options.signal?.throwIfAborted();
  resize();
  original.beforeFrame?.();
  original.onFrame?.(explorer.render());
  invalidate();
  return invalidate;
}
