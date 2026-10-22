import type { StatsReport } from '../../../../../sdk-core/src/modules/stats/report.ts'
import type { StatsWords } from '../../../../../sdk-core/src/modules/stats/words.ts'
import { applyLayout, buildPanel, type PanelParts, type PanelState } from './build.ts'
import { startClock } from './clock.ts'
import { bindGestures } from './gestures.ts'
import { loadLayout, saveLayout, sizeClass, type Layout, type StatsCorner } from './layout.ts'
import { panelWords } from './panelWords.ts'
import { createPlacer } from './place.ts'
import { createRenderer } from './render.ts'
import { createRowList } from './rows.ts'
import { sparkline } from './spark.ts'

/**
 * The profiler overlay of the stats module: a header line (frames a second, the frame's time and
 * the CPU and GPU times), a sparkline of the last reports' CPU and GPU times against the display's
 * refresh budget, the summary block (frame, GPU, CPU, wait, what limits the frame, how long an image stays on
 * the display's refresh), then a bar of tabs of which one shows its rows. The summary and the
 * bar are always shown and one tab holds at most about eighteen rows, so the open panel never
 * scrolls on a 1080p view.
 *
 * Rows follow the report's order, never sorted; a row is an element made once, keyed by its section
 * and key, and rewritten in place at each tick. A GPU stage of several passes folds and unfolds them
 * with a click; a stage of one pass is that pass, shown alone, nothing to fold. The body is the
 * fixed block first (sparkline, summary, tabs), then the rows, the whole flowing into balanced
 * columns; how the panel is placed and how many columns it takes is told on `place` and `fit`.
 * Counts are written with the page's language (`<html lang>`). It scales with the view (its font
 * and width follow the viewport, never more than about 30% of it), starts folded on a phone; a
 * click on the header, or the key left of 1, folds it to that line; a drag on the header moves it
 * to another corner. Tab, folds and corner are kept per viewer and per view size
 * (`localStorage`). Its numbers change four times a second, only while it is visible; folded,
 * only its header line.
 */

/** What the viewer's clicks change: a tab, a stage's fold; each saves the layout and draws again. */
function bindClicks(
  parts: PanelParts,
  state: PanelState,
  layout: Layout,
  redraw: () => void,
  place: () => void,
) {
  for (const [id, button] of parts.tabButtons)
    button.addEventListener('click', () => {
      layout.tab = id
      saveLayout(state.size, layout)
      redraw()
    })
  // A click on a stage row folds or unfolds its passes.
  parts.rowsBox.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.t3s-row[data-fold]')
    if (!row?.dataset.key) return
    layout.unfolded[row.dataset.key] = !layout.unfolded[row.dataset.key]
    saveLayout(state.size, layout)
    redraw()
    place()
  })
}

/** The header's gestures: a click folds the panel; a drag of more than a few pixels moves it to the
 *  nearest corner. Returns what unbinds them. */
function bindHeader(
  parts: PanelParts,
  state: PanelState,
  layout: Layout,
  read: (full: boolean) => StatsReport | null,
  redraw: () => void,
  place: () => void,
) {
  const setCompact = (compact: boolean) => {
    layout.compact = compact
    // Unfolding shows every section: a full report is read first, never the summary-only one the
    // folded panel held.
    if (!compact) state.latest = read(true) ?? state.latest
    parts.panel.toggleAttribute('data-compact', compact)
    saveLayout(state.size, layout)
    redraw()
    place()
  }
  return bindGestures(
    parts.head,
    parts.panel,
    parts.area,
    layout,
    () => setCompact(!layout.compact),
    () => {
      saveLayout(state.size, layout)
      place()
    },
  )
}

/** Watches the frame's size: a frame that crosses a size class takes that class's layout (the
 *  gestures keep the same object, so it is filled in place); what the viewer changes from then on
 *  is saved into the new class. Returns what stops it. */
function observeFrame(
  parts: PanelParts,
  state: PanelState,
  layout: Layout,
  corner: StatsCorner,
  redraw: () => void,
  place: () => void,
) {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const resizes = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect
    if (box) [state.frameWidth, state.frameHeight] = [box.width, box.height]
    const next = sizeClass(parts.area)
    if (next !== state.size) {
      state.size = next
      Object.assign(layout, loadLayout(next, corner))
      applyLayout(parts, layout)
      redraw()
    }
    place()
  })
  resizes.observe(parts.area)
  return () => resizes.disconnect()
}

/**
 * The stats overlay over `parent`, filled from `read` (the latest report, null before the first):
 * at `corner` unless the viewer moved it, showing the report's sections, with the labels and
 * hints of `words` over the module's own. Returns what stops it, removing all it added.
 */
export function statsPanel(
  parent: HTMLElement,
  read: (full: boolean) => StatsReport | null,
  options: { corner: StatsCorner; words?: StatsWords },
) {
  const words = panelWords(options.words)
  const parts = buildPanel(parent, words)
  const { area } = parts
  // The frame covers the view the panel sits on: its size, not the parent's (whose own may wait on
  // a stylesheet), decides the size class.
  const state: PanelState = {
    size: sizeClass(area),
    frameWidth: area.clientWidth,
    frameHeight: area.clientHeight,
    latest: null,
  }
  const layout = loadLayout(state.size, options.corner)
  applyLayout(parts, layout)
  const rows = createRowList(parts.rowsBox, layout, words)
  const { place, fit } = createPlacer(parts, state, layout, rows)
  const spark = sparkline(parts.sparkCanvas)
  const render = createRenderer({ parts, words, layout, rows, spark, fit })
  const redraw = () => {
    if (state.latest) render(state.latest)
  }
  bindClicks(parts, state, layout, redraw, place)
  const clock = startClock({ parts, state, layout, read, render, spark, place })
  const unbind = bindHeader(parts, state, layout, read, redraw, place)
  const unobserve = observeFrame(parts, state, layout, options.corner, redraw, place)
  clock.sync()

  return {
    stop() {
      clock.stop()
      spark.stop()
      unobserve()
      unbind()
      area.remove()
    },
  }
}
