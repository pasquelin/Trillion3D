import { fill, kitWord } from './words.ts';

/**
 * The frame cadence the stats corner shows: how many of the display's refreshes each frame held.
 * A frame that misses one refresh waits for the next, so on a display that keeps its grid a frame
 * lasts a whole number of refreshes, and 60 to 80 frames a second on a 120 Hz display is a mix of
 * frames held once and twice. Both numbers are the engine's: the interval between the rAF
 * timestamps of two frames it drew (`rafIntervalMs`) and the refresh it measured on them
 * (`displayRefreshMs`), never a refresh assumed here.
 */

/** Refreshes a frame held, at most counted apart: three and more are one share. */
const MOST = 3;

/** How the frames of the window held the display: the refresh, and the share of frames that held
 *  it once, twice, three times or more. */
export interface Cadence {
  refreshMs: number;
  shares: [once: number, twice: number, more: number];
}

/** The refreshes an interval of `intervalMs` held, at `refreshMs` each: one at least. */
const refreshesHeld = (intervalMs: number, refreshMs: number) =>
  Math.max(1, Math.round(intervalMs / refreshMs));

/** The shares of the measured `intervals` (`NaN` for a frame that measured none) that held the
 *  display one, two, and three or more refreshes of `refreshMs`; `null` without a measured
 *  interval or a refresh. */
export function cadenceOf(intervals: readonly number[], refreshMs: number | null): Cadence | null {
  if (!refreshMs || !(refreshMs > 0)) return null;
  const shares: Cadence['shares'] = [0, 0, 0];
  let measured = 0;
  for (const interval of intervals)
    if (!Number.isNaN(interval)) {
      shares[Math.min(MOST, refreshesHeld(interval, refreshMs)) - 1]++;
      measured++;
    }
  if (!measured) return null;
  for (let i = 0; i < MOST; i++) shares[i] /= measured;
  return { refreshMs, shares };
}

/** The corner's rows of `cadence` — each share of frames by the refreshes they held, its bar that
 *  share — then the GPU's idle before its last measured image (`gpuIdleMs`), each in the page's
 *  language; none for what was not measured. */
export function cadenceRows(
  cadence: Cadence | null | undefined,
  gpuIdleMs: number | null | undefined,
) {
  const rows: [label: string, value: string, unit: string, share: number | null][] = [];
  cadence?.shares.forEach((share, i) => {
    const n = i + 1 < MOST ? String(i + 1) : `${MOST}+`;
    rows.push([
      fill(kitWord('stats', '{n}× refresh', '{n}× refresh'), { n }),
      String(Math.round(share * 100)),
      '%',
      share,
    ]);
  });
  if (gpuIdleMs != null)
    rows.push([kitWord('stats', 'GPU idle', 'GPU idle'), gpuIdleMs.toFixed(2), 'ms', null]);
  return rows;
}
