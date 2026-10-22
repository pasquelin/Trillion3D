import type { Layout } from './layout.ts'
import type { PanelParts, PanelState } from './build.ts'
import type { RowList } from './rows.ts'

/** The most columns the rows flow into. */
const MAX_COLUMNS = 4

/** The panel's margin to the view's edges, `.75rem` in pixels. */
const marginPx = () =>
  0.75 * (parseFloat(getComputedStyle(globalThis.document.documentElement).fontSize) || 16)

/**
 * Where the panel sits and how many columns its rows flow into. `place` runs on placement events
 * only (first report, corner change, view resize, fold of the panel or of a stage), never per
 * tick; `fit` also after a report that changed the open tab or its rows.
 */
export function createPlacer(parts: PanelParts, state: PanelState, layout: Layout, rows: RowList) {
  const { panel, area, rowsBox } = parts
  const setColumns = (columns: number) => panel.style.setProperty('--cols', String(columns))
  // The height of one row, measured at each placement from a row on screen (the last one measured
  // stays while no row is shown).
  let rowHeight = 0
  let fitKey = ''

  /**
   * Fits the open tab under the panel's top: the fewest columns, up to `MAX_COLUMNS`, whose
   * balanced flow (the fixed block first, the rows right under it, then on into the next column)
   * ends within the view's bottom margin, so no column leaves a hole and nothing is cut or
   * scrolled. Measured, at most `MAX_COLUMNS` layouts, and only when the open tab, its row count,
   * the view or the corner changed — never on a plain tick.
   */
  const fit = () => {
    if (panel.hasAttribute('data-empty') || layout.compact) return
    const key = `${layout.tab}|${rowsBox.childElementCount}|${state.frameHeight}|${layout.corner}`
    if (key === fitKey) return
    fitKey = key
    const limit = area.getBoundingClientRect().bottom - marginPx()
    let columns = 1
    setColumns(columns)
    while (columns < MAX_COLUMNS && panel.getBoundingClientRect().bottom > limit + 0.5)
      setColumns(++columns)
  }

  /**
   * Places the panel. A panel in a bottom corner is placed by its top, from its tallest tab laid in
   * one column (capped to the view's height), so the header, summary and tabs stay put whatever
   * tab or fold is open; in a top corner the stylesheet anchors it.
   */
  const place = () => {
    if (panel.hasAttribute('data-empty')) return
    panel.style.removeProperty('top')
    panel.style.removeProperty('bottom')
    fitKey = ''
    const margin = marginPx()
    const placeTop = (height: number) => {
      if (!layout.corner.startsWith('bottom')) return
      panel.style.top = `${Math.max(margin, area.clientHeight - margin - height)}px`
      panel.style.bottom = 'auto'
    }
    if (layout.compact) {
      // Only the header shows: it sits at the margin of its corner.
      placeTop(panel.offsetHeight)
      return
    }
    setColumns(1)
    // A row's height with the space between rows: the rows area over the rows it shows.
    const shown = rowsBox.childElementCount
    if (shown) rowHeight = rowsBox.offsetHeight / shown
    const most = Math.max(0, ...(state.latest?.sections.map(rows.count) ?? [])) * rowHeight
    placeTop(panel.offsetHeight - rowsBox.offsetHeight + most)
    fit()
  }
  return { place, fit }
}
