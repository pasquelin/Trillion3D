/**
 * THE ONE BACKOFF of the engine's retries (#1527): what a refused compile (`../../lighting/deferred/fullscreen.ts`) and a refused GPU grant
 * (`refusal.ts`) wait before they are tried again. The wait is time, not frames: a view at rest enters no frame, and a page whose frames run
 * fast or slow asks the device at the same pace. It starts at `RETRY_MS`, doubles at each refusal in a row up to `MAX_RETRY_MS`, and is
 * spread by `JITTER` either way, so that the many pipelines and grants a device refused together do not ask it again in one burst.
 */

/** The time, in milliseconds, a refusal first waits before it is tried again. */
export const RETRY_MS = 4000

/** The longest wait between two tries of a refusal that keeps coming: tried on, slowly, as memory may come back. */
export const MAX_RETRY_MS = RETRY_MS * 64

/** The share of a wait it is spread by, either way (a quarter). */
export const JITTER = 0.25

/** The wait, in milliseconds, after the `refusals`-th refusal in a row (one for the first): `RETRY_MS` doubled at each one, capped at `MAX_RETRY_MS`, spread by `JITTER` with `random` (a number in 0 .. 1, `Math.random`) — the spread never takes it past the cap. */
export const backoffMs = (refusals: number, random = Math.random()) =>
  Math.min(
    Math.min(RETRY_MS * 2 ** (refusals - 1), MAX_RETRY_MS) * (1 + JITTER * (2 * random - 1)),
    MAX_RETRY_MS,
  )
