import type { SectionId } from './statsRows.ts';

export type StatsCorner = 'bottom-left' | 'top-left' | 'bottom-right' | 'top-right';
const CORNERS: readonly StatsCorner[] = ['bottom-left', 'top-left', 'bottom-right', 'top-right'];

/** What the viewer chose: folded to the header, the corner, and each section open or not. */
export interface Layout {
  compact: boolean;
  corner: StatsCorner;
  open: Record<SectionId, boolean>;
}

/** The size class of the view: a phone, a small view, or a large one; each keeps its layout. */
export function sizeClass(parent: HTMLElement): 's' | 'm' | 'l' {
  const sized = parent.clientWidth > 0 && parent.clientHeight > 0;
  const width = sized ? parent.clientWidth : (globalThis.innerWidth ?? 1920),
    height = sized ? parent.clientHeight : (globalThis.innerHeight ?? 1080);
  return width < 560 ? 's' : width < 1000 || height < 700 ? 'm' : 'l';
}

const STORE = 't3d.stats.';
export function loadLayout(size: string, corner: StatsCorner): Layout {
  const open = size === 'l';
  const fallback: Layout = {
    compact: size === 's',
    corner,
    open: { cadence: open, cpu: open, gpu: open, shadows: open, scene: open },
  };
  try {
    const saved = JSON.parse(
      globalThis.localStorage?.getItem(STORE + size) ?? 'null',
    ) as Partial<Layout> | null;
    if (!saved) return fallback;
    return {
      compact: saved.compact ?? fallback.compact,
      corner: CORNERS.includes(saved.corner as StatsCorner)
        ? (saved.corner as StatsCorner)
        : corner,
      open: { ...fallback.open, ...saved.open },
    };
  } catch {
    return fallback;
  }
}
export function saveLayout(size: string, layout: Layout) {
  try {
    globalThis.localStorage?.setItem(STORE + size, JSON.stringify(layout));
  } catch {
    // A private window or blocked storage: the layout lasts the page.
  }
}
