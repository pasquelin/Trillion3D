/**
 * The frame constants every engine shares: sizes, budgets, batch ceilings. Nothing here builds or
 * reads a host object, so this module names no rendering library — the host-library objects a
 * witness publishes live in `../host/scene/objects.ts`.
 */
/** The ratio a session's drawing buffer was sized at (`devicePixels`): read live, a resize
 *  rewrites it. */
export const pixelRatioOf = (options: { pixelRatio?: number }) =>
  options.pixelRatio ?? DEFAULT_PIXEL_RATIO;

export const DEFAULT_FOV = 55,
  DEFAULT_PIXEL_RATIO = 1,
  DEFAULT_WIDTH = 960,
  DEFAULT_HEIGHT = 540,
  DEFAULT_PAGE_WORKERS = 32,
  PREFETCH_BATCH = 64,
  /** Addresses a frame issues at most, taken from the head of the priority-ordered list. */
  PAGE_REQUEST_BATCH = 256,
  /** Cache pages a frame queues at most in the arrival queue. */
  ARRIVAL_QUEUE_BATCH = 64,
  /** Milliseconds a frame spends at most integrating arrived pages. */
  ARRIVAL_BUDGET_MS = 2,
  /**
   * The residency queue's PUBLISHED main-thread share, in milliseconds: past it its admissions start
   * no page and yield a task (`../page/integration/frameBudget.ts`), so a due frame waits on
   * streaming no longer than the share and the page begun within it. The next task resumes at once,
   * in a visible tab as in a hidden one, where no frame comes. Half of the programme's 2 ms
   * main-thread frame (#483); the cut, the physics page stage and the encode share the other half.
   * Fetching and decoding run in workers and spend none of it.
   */
  STREAMING_FRAME_MS = 1,
  /**
   * Shares of `STREAMING_FRAME_MS` the residency queue opens at most between two frames of a visible
   * page, 2 ms cumulated (#983): past them it waits for the next frame, so no burst of shares holds
   * a frame back. A hidden page, where no frame comes, or a visible one whose frames stopped, keeps
   * opening one per task.
   */
  STREAMING_SHARES_PER_FRAME = 2,
  /**
   * How far ahead of a moving camera the cut requests pages, in milliseconds: the programme's time
   * to full detail after a stop (#483). A page the camera reaches within it is asked for now, so the
   * queue that fills a stopped view in that time has it when the view does (`../gpu/core/aheadView.ts`).
   */
  PREFETCH_HORIZON_MS = 250,
  /** The farthest the view ahead looks, in milliseconds, whatever the round trip: past a second,
   *  the camera's velocity no longer says where it will be. */
  MAX_PREFETCH_HORIZON_MS = 1000,
  PREFETCH_INTERVAL_MS = 250,
  DEFAULT_CACHED_PAGES = 16384,
  DEFAULT_CLEAR_COLOR = 0x171d28;
/**
 * How far ahead of a moving camera the cut requests pages, in milliseconds: the published horizon
 * plus the pages' measured round trip (`../streaming/roundTrip.ts`) — a page asked for now lands a
 * round trip later — at most `MAX_PREFETCH_HORIZON_MS`. No round trip measured, or none that reads
 * as a duration: the published horizon, as before.
 */
export const prefetchHorizonMs = (roundTripMs?: number) =>
  roundTripMs! > 0
    ? Math.min(PREFETCH_HORIZON_MS + roundTripMs!, MAX_PREFETCH_HORIZON_MS)
    : PREFETCH_HORIZON_MS;
/**
 * Device pixels of a logical dimension, at the ratio the host has set. Canvas creation and
 * resize both compute it: two separate truncations would have ended up with a canvas of one
 * size and a viewport of another.
 */
export const devicePixels = (logical: number, pixelRatio: number | undefined) =>
  Math.floor(logical * (pixelRatio ?? DEFAULT_PIXEL_RATIO));
/** The adapter's own limits the session's device asks for: WebGPU grants the portable defaults
 *  otherwise — a shadow pool layer is as wide as `maxTextureDimension2D` (`shadow/poolSize.ts`). */
export const WEBGPU_REQUIRED_LIMITS = [
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxStorageBufferBindingSize',
  'maxBufferSize',
] as const;
/**
 * True when the work under `signal` was cancelled: an error then is its cancellation, whatever its
 * name — no failure is diagnosed, nothing falls back. An `AbortError` under a live signal is a
 * failure like any other.
 */
export const isCancelled = (signal: AbortSignal | undefined) => signal?.aborted === true;
