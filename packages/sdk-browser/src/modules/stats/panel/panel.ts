import { STATS_TABS, type StatsTab } from '../../../../../sdk-core/src/modules/stats/counters.ts'
import {
  CADENCE_BUCKETS,
  type StatsReport,
  type StatsRow,
  type StatsSection,
} from '../../../../../sdk-core/src/modules/stats/report.ts'
import {
  statsPassWord,
  statsWord,
  type StatsWords,
} from '../../../../../sdk-core/src/modules/stats/words.ts'
import {
  fillRow,
  format,
  make,
  makeLegend,
  makeRow,
  put,
  setClass,
  setTitle,
  tone,
  UNIT_TEXT,
} from './dom.ts'
import { FALLBACK_REFRESH_MS } from '../../../frame/scale/scaleTargets.ts'
import { STATS_PERIOD_MS } from '../collect.ts'
import { bindGestures } from './gestures.ts'
import { loadLayout, saveLayout, sizeClass, type StatsCorner } from './layout.ts'
import { sparkline } from './spark.ts'
import { STYLE } from './style.ts'

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

/** The most columns the rows flow into. */
const MAX_COLUMNS = 4

/** The lines of the summary block, in order. */
const SUMMARY_LINES = ['frame', 'gpu', 'cpu', 'wait', 'gpuIdle', 'bottleneck', 'screen'] as const

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
  // One lookup per key for the panel's life.
  const wordsByKey = new Map<string, { label: string; hint: string }>()
  const word = (key: string, field: 'label' | 'hint') => {
    let entry = wordsByKey.get(key)
    if (!entry) wordsByKey.set(key, (entry = statsWord(key, options.words)))
    return entry[field]
  }
  const labelOf = (key: string, raw?: boolean) => (raw ? key : word(key, 'label'))
  // A GPU pass is named by its engine label: shortened, then in the page's words.
  const passes = new Map<string, { label: string; hint: string }>()
  const passWord = (name: string) => {
    let entry = passes.get(name)
    if (!entry) passes.set(name, (entry = statsPassWord(name, options.words)))
    return entry
  }
  // The language numbers are written in: the page's.
  const localeNow = () => globalThis.document?.documentElement.lang || undefined
  // A row naming a number (`page.view.<index>`) takes its words from the key without the index.
  const rowKey = (row: StatsRow) =>
    row.n === undefined ? row.key : row.key.slice(0, row.key.lastIndexOf('.'))
  const rowLabel = (row: StatsRow) =>
    row.n === undefined
      ? labelOf(row.key, row.raw)
      : labelOf(rowKey(row)).replace('{n}', String(row.n))

  // The frame covers the view the panel sits on: its size, not the parent's (whose own may wait on
  // a stylesheet), decides the size class.
  const area = make('div', 't3s-frame')
  const style = make('style')
  style.textContent = STYLE
  area.append(style)
  parent.append(area)
  let size = sizeClass(area)
  // The frame's size as the resize observer last reported it: a tick reads it, never the layout.
  let frameWidth = area.clientWidth,
    frameHeight = area.clientHeight
  const layout = loadLayout(size, options.corner)
  const panel = make('section', 't3s')
  panel.dataset.corner = layout.corner
  panel.setAttribute('aria-label', word('panel.label', 'label'))
  panel.toggleAttribute('data-empty', true)

  const head = make('div', 't3s-head')
  head.tabIndex = 0
  head.setAttribute('role', 'button')
  head.title = word('panel.hint', 'label')
  const dot = make('span', 't3s-dot'),
    fps = make('b', 't3s-big'),
    frame = make('b'),
    held = make('span', 't3s-tag'),
    last = make('span', 't3s-tag'),
    worldTag = make('span', 't3s-tag'),
    cpuHead = make('b'),
    gpuHead = make('b'),
    cg = make('span', 't3s-cg')
  cg.append(
    `${labelOf('summary.cpuShort')} `,
    cpuHead,
    ` · ${labelOf('summary.gpuShort')} `,
    gpuHead,
    ' ms',
  )
  head.append(
    dot,
    fps,
    make('span', 't3s-u', labelOf('unit.fps')),
    frame,
    make('span', 't3s-u', 'ms'),
    held,
    last,
    worldTag,
    cg,
  )

  const body = make('div', 't3s-body')
  const sparkCanvas = make('canvas', 't3s-spark')
  const { legend, budget } = makeLegend(labelOf('summary.gpuShort'), labelOf('summary.cpuShort'))
  const spark = sparkline(sparkCanvas)

  const summary = make('div', 't3s-sum')
  const lines = Object.fromEntries(
    SUMMARY_LINES.map((id) => {
      const line = make('div', 't3s-line')
      const label = make('span'),
        value = make('span')
      line.append(label, value)
      summary.append(line)
      return [id, { label, value, line }]
    }),
  )

  const tabs = make('div', 't3s-tabs')
  tabs.setAttribute('role', 'tablist')
  const tabButtons = new Map<StatsTab, HTMLButtonElement>()
  for (const id of STATS_TABS) {
    const button = make('button', 't3s-tab')
    button.type = 'button'
    button.setAttribute('role', 'tab')
    button.hidden = true
    button.addEventListener('click', () => {
      layout.tab = id
      saveLayout(size, layout)
      redraw()
    })
    tabButtons.set(id, button)
    tabs.append(button)
  }

  const sectionHead = make('div', 't3s-sh')
  const sectionName = make('span'),
    sectionTotal = make('span'),
    sectionUnit = make('span'),
    sectionNote = make('span', 't3s-note')
  sectionHead.append(sectionName, sectionTotal, sectionUnit, sectionNote)
  const rowsBox = make('div')
  // The fixed block: what never moves when a tab or a fold changes.
  const fixedBlock = make('div', 't3s-fixed')
  fixedBlock.append(sparkCanvas, legend, summary, tabs, sectionHead)
  body.append(fixedBlock, rowsBox)
  panel.append(head, body)
  area.append(panel)

  // A click on a stage row folds or unfolds its passes.
  rowsBox.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.t3s-row[data-fold]')
    if (!row?.dataset.key) return
    layout.unfolded[row.dataset.key] = !layout.unfolded[row.dataset.key]
    saveLayout(size, layout)
    redraw()
    place()
  })

  // The rows made so far by `<section>/<row>[/<pass>]`: a tick rewrites them, never rebuilds them.
  const rowElements = new Map<string, HTMLElement>()
  // A stage of one pass is that pass: it folds nothing.
  const folds = (row: StatsRow) => (row.children?.length ?? 0) > 1
  const showRows = (section: StatsSection, locale: string | undefined) => {
    const seen = new Set<string>()
    let index = 0
    const place = (row: StatsRow, key: string, depth: number) => {
      const stage = folds(row)
      const folded = stage ? (layout.unfolded[key] ? 'open' : 'closed') : null
      let element = rowElements.get(key)
      if (!element) {
        element = makeRow(section.id, key)
        rowElements.set(key, element)
      }
      seen.add(key)
      if (rowsBox.children[index] !== element)
        rowsBox.insertBefore(element, rowsBox.children[index] ?? null)
      index++
      // A pass (a raw row under a stage) is named by its engine label, `×n` when it sums n numbered
      // passes of one family; a stage of one pass shows that pass's name beside its own hint.
      const pass = depth > 0 && row.raw ? passWord(row.key) : null
      const only = row.children?.length === 1 ? passWord(row.children[0].key) : null
      const hint = pass ? pass.hint : word(rowKey(row), 'hint')
      fillRow(
        element,
        row,
        pass
          ? row.count && row.count > 1
            ? `${pass.label} ×${row.count}`
            : pass.label
          : rowLabel(row),
        only?.hint ? `${hint} ${only.label}: ${only.hint}` : hint,
        folded,
        depth,
        labelOf('row.max'),
        locale,
      )
      if (folded === 'open')
        for (const child of row.children!) place(child, `${key}/${child.key}`, depth + 1)
    }
    for (const row of section.rows) place(row, `${section.id}/${row.key}`, 0)
    while (rowsBox.children.length > index) rowsBox.lastElementChild!.remove()
    for (const key of rowElements.keys()) if (!seen.has(key)) rowElements.delete(key)
  }

  /** The panel's margin to the view's edges, `.75rem` in pixels. */
  const marginPx = () =>
    0.75 * (parseFloat(getComputedStyle(globalThis.document.documentElement).fontSize) || 16)
  // The height of one row, measured at each placement from a row on screen (the last one measured
  // stays while no row is shown).
  let rowHeight = 0
  /** The rows a section shows: its rows and the passes of its unfolded stages. */
  const rowsIn = (section: StatsSection) =>
    section.rows.reduce(
      (count, row) =>
        count +
        1 +
        (folds(row) && layout.unfolded[`${section.id}/${row.key}`] ? row.children!.length : 0),
      0,
    )

  /** Sets the column count. */
  const setColumns = (columns: number) => panel.style.setProperty('--cols', String(columns))

  /**
   * Places the panel. A panel in a bottom corner is placed by its top, from its tallest tab laid in
   * one column (capped to the view's height), so the header, summary and tabs stay put whatever
   * tab or fold is open; in a top corner the stylesheet anchors it. Run on placement events only
   * (first report, corner change, view resize, fold of the panel or of a stage), never per tick.
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
    const most = Math.max(0, ...(latest?.sections.map(rowsIn) ?? [])) * rowHeight
    placeTop(panel.offsetHeight - rowsBox.offsetHeight + most)
    fit()
  }

  /**
   * Fits the open tab under the panel's top: the fewest columns, up to `MAX_COLUMNS`, whose balanced
   * flow (the fixed block first, the rows right under it, then on into the next column) ends within
   * the view's bottom margin, so no column leaves a hole and nothing is cut or scrolled. Measured,
   * at most `MAX_COLUMNS` layouts, and only when the open tab, its row count, the view or the corner
   * changed — never on a plain tick.
   */
  let fitKey = ''
  const fit = () => {
    if (panel.hasAttribute('data-empty') || layout.compact) return
    const key = `${layout.tab}|${rowsBox.childElementCount}|${frameHeight}|${layout.corner}`
    if (key === fitKey) return
    fitKey = key
    const limit = area.getBoundingClientRect().bottom - marginPx()
    let columns = 1
    setColumns(columns)
    while (columns < MAX_COLUMNS && panel.getBoundingClientRect().bottom > limit + 0.5)
      setColumns(++columns)
  }

  // The last report: what a tab switch or a fold shows again without waiting for the next tick.
  let latest: StatsReport | null = null
  const render = (report: StatsReport) => {
    const { summary: s } = report
    const locale = localeNow()
    const budgetMs = s.refreshMs ?? FALLBACK_REFRESH_MS
    const colour = tone(s.frameMs, budgetMs)
    setClass(dot, `t3s-dot ${colour}`)
    put(fps, s.fps == null ? '—' : String(Math.round(s.fps)))
    put(frame, format(s.frameMs, 'ms'))
    setClass(frame, colour)
    put(held, s.held ? labelOf('summary.held') : '')
    put(last, s.gpuLast ? labelOf('summary.last') : '')
    // On a page of several worlds: the first made is the main view, the others are worlds.
    put(
      worldTag,
      s.worldCount > 1
        ? `${labelOf(s.worldIndex === 0 ? 'summary.mainView' : 'summary.world')} · ${s.worldIndex + 1}/${s.worldCount}`
        : '',
    )
    put(cpuHead, format(s.cpuMs, 'ms'))
    put(gpuHead, format(s.gpuNowMs, 'ms'))
    setClass(gpuHead, tone(s.gpuNowMs, budgetMs))
    panel.removeAttribute('data-empty')
    if (layout.compact) return

    spark.draw(budgetMs)
    put(budget, ` ${labelOf('summary.budget')} ${format(budgetMs, 'ms')}`)

    const values = {
      frame: s.frameMs,
      gpu: s.gpuMs,
      cpu: s.cpuMs,
      wait: s.waitMs,
      gpuIdle: s.gpuIdleMs,
    }
    for (const id of SUMMARY_LINES) {
      const { label, value, line } = lines[id]
      const key = `summary.${id}`
      if (id === 'screen') {
        // One line like the others: the display's rate, and the refreshes a typical image stays;
        // the tooltip holds the distribution.
        const n = s.refreshesPerImage
        put(label, labelOf(key).replace('{hz}', String(Math.round(1000 / budgetMs))))
        put(value, n === null ? '—' : labelOf('summary.screenValue').replace('{n}', String(n)))
        const shares = s.cadence
          .filter((bucket) => bucket.share >= 0.005)
          .map((bucket) =>
            labelOf(
              bucket.refreshes >= CADENCE_BUCKETS
                ? 'summary.screenShareOrMore'
                : 'summary.screenShare',
            )
              .replace('{share}', String(Math.round(bucket.share * 100)))
              .replace('{n}', String(bucket.refreshes)),
          )
        setTitle(line, [word(key, 'hint'), shares.join(' · ')].filter(Boolean).join(' '))
        continue
      }
      put(
        label,
        id === 'gpu' && s.gpuLast ? `${labelOf(key)} · ${labelOf('summary.last')}` : labelOf(key),
      )
      if (id === 'bottleneck') {
        put(value, s.bottleneck ? labelOf(`bottleneck.${s.bottleneck}`) : '—')
        setTitle(line, s.bottleneck ? word(`bottleneck.${s.bottleneck}`, 'hint') : '')
      } else {
        // The GPU's idle is shown only when measured.
        line.hidden = id === 'gpuIdle' && values.gpuIdle == null
        put(value, `${format(values[id], 'ms')} ms`)
        setTitle(line, word(key, 'hint'))
      }
    }
    const { sections } = report
    const section = sections.find((one) => one.id === layout.tab) ?? sections[0]
    for (const [id, button] of tabButtons) {
      button.hidden = !sections.some((one) => one.id === id)
      button.setAttribute('aria-selected', String(id === section?.id))
      put(button, labelOf(`tab.${id}`))
      setTitle(button, word(`tab.${id}`, 'hint'))
    }
    sectionHead.hidden = rowsBox.hidden = !section
    if (!section) return
    put(sectionName, labelOf(`tab.${section.id}`))
    put(sectionTotal, format(section.total, section.unit, locale))
    put(sectionUnit, UNIT_TEXT[section.unit])
    put(sectionNote, section.includedIn === 'gpu' ? labelOf('shadows.included') : '')
    showRows(section, locale)
    fit()
  }
  const redraw = () => {
    if (latest) render(latest)
  }
  const tick = () => {
    // The frame is out of the page or under a closed ancestor: nothing to read or draw. The panel
    // itself starts empty (not displayed), so only its frame says whether the page shows it.
    if (!area.isConnected || frameWidth <= 0 || frameHeight <= 0) return
    // Folded, the header needs only the summary: the CPU step window is left alone.
    const report = read(!layout.compact)
    // The collector hands the same report until its period ends: nothing to push or draw again.
    if (!report || report === latest) return
    latest = report
    const first = panel.hasAttribute('data-empty')
    const { summary: s } = report
    // A held or earlier image's GPU time is not this report's: the sparkline gets a gap.
    spark.push(s.cpuMs, s.gpuNowMs)
    render(report)
    if (first) place()
  }

  // The timer runs only while the panel is on a visible page; folded, a tick writes the header alone.
  let timer: ReturnType<typeof setInterval> | undefined
  const sync = () => {
    const running = !globalThis.document?.hidden
    if (running && timer === undefined) {
      tick()
      timer = setInterval(tick, STATS_PERIOD_MS)
    } else if (!running && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  const setCompact = (compact: boolean) => {
    layout.compact = compact
    // Unfolding shows every section: a full report is read first, never the summary-only one the
    // folded panel held.
    if (!compact) latest = read(true) ?? latest
    panel.toggleAttribute('data-compact', compact)
    saveLayout(size, layout)
    redraw()
    place()
  }
  panel.toggleAttribute('data-compact', layout.compact)
  globalThis.document?.addEventListener('visibilitychange', sync)

  // A click folds; a drag of more than a few pixels moves the panel to the nearest corner.
  const unbind = bindGestures(
    head,
    panel,
    area,
    layout,
    () => setCompact(!layout.compact),
    () => {
      saveLayout(size, layout)
      place()
    },
  )
  // A frame that crosses a size class takes that class's layout (the gestures keep the same object,
  // so it is filled in place); what the viewer changes from then on is saved into the new class.
  const resizes =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver((entries) => {
          const box = entries[entries.length - 1]?.contentRect
          if (box) [frameWidth, frameHeight] = [box.width, box.height]
          const next = sizeClass(area)
          if (next !== size) {
            size = next
            Object.assign(layout, loadLayout(size, options.corner))
            panel.dataset.corner = layout.corner
            panel.toggleAttribute('data-compact', layout.compact)
            redraw()
          }
          place()
        })
  resizes?.observe(area)
  sync()

  return {
    stop() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      globalThis.document?.removeEventListener('visibilitychange', sync)
      spark.stop()
      resizes?.disconnect()
      unbind()
      area.remove()
    },
  }
}
