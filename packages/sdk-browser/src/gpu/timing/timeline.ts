import { nanosecondsToMs } from './types.ts';

/**
 * The device's idle between two consecutive images (#1451).
 *
 * `hostGapMs` is the host time INSIDE one image, between two of its own submissions; an image that
 * submits once therefore always reports zero there. What the loop costs is the device's idle
 * BETWEEN two images, and neither end of that gap is a query of its own: they are the previous
 * image's last timestamp and this image's first, both already resolved with the image's passes.
 *
 * Only an image's immediate predecessor is an end to measure from: between two sampled images
 * farther apart, the images in between ran on the device untimed, and the gap would count their
 * work as idle. An image that did not resolve whole — truncated, or a pair it could not read —
 * leaves no end, and the next image then publishes no idle rather than one measured against an
 * end that is not the image's last.
 */

/** A gap longer than this is a pause, not a frame: the refresh clock's own bound (under 10 fps,
 *  `../../frame/refreshClock.ts`). The loop sleeps on a still scene and wakes seconds later, and a
 *  device clock can stop (a frozen tab, a device loss): such a gap is withheld, never published as
 *  an idle the frame period cannot hold. */
const IDLE_CEILING_MS = 100;

/** An image's first and last timestamps on the device timeline, ns. */
export type ImageSpan = { beginNs: bigint; endNs: bigint };

/**
 * The idle from `previous`'s last timestamp to `span`'s first, ms, or `null` when the two are not
 * comparable: no predecessor, an image with no whole span, a timeline that went backwards, or a gap
 * past `IDLE_CEILING_MS`. Zero is a measurement: the image began the nanosecond the last ended.
 */
function idleBetweenMs(span: ImageSpan | null, previous: ImageSpan | null): number | null {
  if (!span || !previous || span.beginNs < previous.endNs) return null;
  const idle = nanosecondsToMs(Number(span.beginNs - previous.endNs));
  return idle > IDLE_CEILING_MS ? null : idle;
}

/** The last image's span, kept by the timer that runs the images, and the idle read against it. */
export function createTimeline() {
  let frame = Number.NaN,
    previous: ImageSpan | null = null;
  return {
    /**
     * Image `at` resolved `span` (`null` when not whole): returns its idle since image `at − 1`,
     * and keeps its span for image `at + 1`. A readback that lands after a later image's leaves
     * nothing, so the end kept is always the latest image's.
     */
    read(at: number, span: ImageSpan | null) {
      if (at <= frame) return null;
      const idle = at === frame + 1 ? idleBetweenMs(span, previous) : null;
      frame = at;
      previous = span;
      return idle;
    },
  };
}
