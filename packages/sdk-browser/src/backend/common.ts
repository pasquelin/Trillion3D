/**
 * The frame constants every engine shares: sizes, budgets, batch ceilings. Nothing here builds or
 * reads a host object, so this module names no rendering library — the host-library objects a
 * witness publishes live in `../host/scene/objects.ts`.
 */
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
   * How far ahead of a moving camera the cut requests pages, in milliseconds: the programme's time
   * to full detail after a stop (#483). A page the camera reaches within it is asked for now, so the
   * queue that fills a stopped view in that time has it when the view does (`../gpu/core/aheadView.ts`).
   */
  PREFETCH_HORIZON_MS = 250,
  PREFETCH_INTERVAL_MS = 250,
  DEFAULT_CACHED_PAGES = 16384,
  DEFAULT_CLEAR_COLOR = 0x171d28;
/**
 * Device pixels of a logical dimension, at the ratio the host has set. Canvas creation and
 * resize both compute it: two separate truncations would have ended up with a canvas of one
 * size and a viewport of another.
 */
export const devicePixels = (logical: number, pixelRatio: number | undefined) =>
  Math.floor(logical * (pixelRatio ?? DEFAULT_PIXEL_RATIO));
export const WEBGPU_REQUIRED_LIMITS = [
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
