import { STATS_TABS, type StatsTab } from '../../../../../sdk-core/src/modules/stats/counters.ts'

/** The corners of the view a panel can sit in. */
const CORNERS = ['bottom-left', 'top-left', 'bottom-right', 'top-right'] as const
export type StatsCorner = (typeof CORNERS)[number]

/** What the viewer chose: folded to the header, the corner, the open tab, and each unfolded GPU stage. */
export interface Layout {
  compact: boolean
  corner: StatsCorner
  tab: StatsTab
  /** The row keys (`<section>/<stage>`) whose passes are shown. */
  unfolded: Record<string, boolean>
}

/** The size class of the view: a phone, a small view, or a large one; each keeps its layout. */
type SizeClass = 's' | 'm' | 'l'

/** The size class of `parent`. */
export function sizeClass(parent: HTMLElement): SizeClass {
  const sized = parent.clientWidth > 0 && parent.clientHeight > 0
  const width = sized ? parent.clientWidth : (globalThis.innerWidth ?? 1920),
    height = sized ? parent.clientHeight : (globalThis.innerHeight ?? 1080)
  return width < 560 ? 's' : width < 1000 || height < 700 ? 'm' : 'l'
}

const STORE = 't3d.stats.panel.'

/** The layout kept for this viewer and size class, or the default of the class: compact on a phone. */
export function loadLayout(size: SizeClass, corner: StatsCorner): Layout {
  const fallback: Layout = { compact: size === 's', corner, tab: STATS_TABS[0], unfolded: {} }
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORE + size) ?? 'null') as Record<
      string,
      unknown
    > | null
    if (!saved || typeof saved !== 'object') return fallback
    const { unfolded } = saved
    const plain =
      typeof unfolded === 'object' &&
      unfolded !== null &&
      !Array.isArray(unfolded) &&
      Object.values(unfolded).every((value) => typeof value === 'boolean')
    return {
      compact: typeof saved.compact === 'boolean' ? saved.compact : fallback.compact,
      corner: CORNERS.includes(saved.corner as StatsCorner)
        ? (saved.corner as StatsCorner)
        : corner,
      tab: STATS_TABS.includes(saved.tab as StatsTab) ? (saved.tab as StatsTab) : fallback.tab,
      unfolded: plain ? { ...(unfolded as Record<string, boolean>) } : {},
    }
  } catch {
    return fallback
  }
}

/** Keeps `layout` for this viewer and size class. */
export function saveLayout(size: SizeClass, layout: Layout) {
  try {
    globalThis.localStorage?.setItem(STORE + size, JSON.stringify(layout))
  } catch {
    // A private window or blocked storage: the layout lasts the page.
  }
}
