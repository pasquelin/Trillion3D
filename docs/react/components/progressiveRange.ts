import type { ProgressiveRange } from '../types/components.ts';

/** Page-range arithmetic for a list that grows in both directions from the visible page. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export function progressiveRange(
  direction: 'back' | 'forward',
  range: ProgressiveRange,
  pageCount: number,
  maxPages: number,
): ProgressiveRange {
  if (pageCount <= 1) return { start: 0, end: 0 };
  if (direction === 'back') {
    const start = Math.max(0, range.start - 1);
    return { start, end: Math.min(pageCount - 1, start + maxPages - 1) };
  }
  const end = Math.min(pageCount - 1, range.end + 1);
  return { start: Math.max(0, end - maxPages + 1), end };
}

export function rangeForScroll(
  scrollY: number,
  rootTop: number,
  heights: Record<string | number, number>,
  pageCount: number,
  maxPages: number,
): ProgressiveRange | null {
  const known = Object.values(heights).filter((height) => height > 0);
  if (!known.length) return null;
  const average = known.reduce((sum, height) => sum + height, 0) / known.length;
  const page = clamp(Math.floor(Math.max(0, scrollY - rootTop) / average), 0, pageCount - 1);
  const start = clamp(page - 1, 0, Math.max(0, pageCount - maxPages));
  return { start, end: Math.min(pageCount - 1, start + maxPages - 1) };
}
