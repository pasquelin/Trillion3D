import {
  CADENCE_BUCKETS,
  type StatsReport,
  type StatsSection,
} from '../../../../../sdk-core/src/modules/stats/report.ts'
import { FALLBACK_REFRESH_MS } from '../../../frame/scale/scaleTargets.ts'
import { SUMMARY_LINES, type PanelParts, type SummaryLine } from './build.ts'
import { format, put, setClass, setTitle, tone, UNIT_TEXT } from './dom.ts'
import type { Layout } from './layout.ts'
import type { PanelWords } from './panelWords.ts'
import type { RowList } from './rows.ts'
import type { sparkline } from './spark.ts'

type Summary = StatsReport['summary']

/** The header line: frames a second, the frame's time, the tags and the CPU and GPU times. */
function renderHeader(parts: PanelParts, { labelOf }: PanelWords, s: Summary, budgetMs: number) {
  const colour = tone(s.frameMs, budgetMs)
  setClass(parts.dot, `t3s-dot ${colour}`)
  put(parts.fps, s.fps == null ? '—' : String(Math.round(s.fps)))
  put(parts.frame, format(s.frameMs, 'ms'))
  setClass(parts.frame, colour)
  put(parts.held, s.held ? labelOf('summary.held') : '')
  put(parts.last, s.gpuLast ? labelOf('summary.last') : '')
  // On a page of several worlds: the first made is the main view, the others are worlds.
  put(
    parts.worldTag,
    s.worldCount > 1
      ? `${labelOf(s.worldIndex === 0 ? 'summary.mainView' : 'summary.world')} · ${s.worldIndex + 1}/${s.worldCount}`
      : '',
  )
  put(parts.cpuHead, format(s.cpuMs, 'ms'))
  put(parts.gpuHead, format(s.gpuNowMs, 'ms'))
  setClass(parts.gpuHead, tone(s.gpuNowMs, budgetMs))
}

/** The screen line, like the others: the display's rate, and the refreshes a typical image stays;
 *  the tooltip holds the distribution. */
function renderScreen(
  { label, value, line }: PanelParts['lines'][SummaryLine],
  { word, labelOf }: PanelWords,
  s: Summary,
  budgetMs: number,
) {
  const key = 'summary.screen'
  const n = s.refreshesPerImage
  put(label, labelOf(key).replace('{hz}', String(Math.round(1000 / budgetMs))))
  put(value, n === null ? '—' : labelOf('summary.screenValue').replace('{n}', String(n)))
  const shares = s.cadence
    .filter((bucket) => bucket.share >= 0.005)
    .map((bucket) =>
      labelOf(
        bucket.refreshes >= CADENCE_BUCKETS ? 'summary.screenShareOrMore' : 'summary.screenShare',
      )
        .replace('{share}', String(Math.round(bucket.share * 100)))
        .replace('{n}', String(bucket.refreshes)),
    )
  setTitle(line, [word(key, 'hint'), shares.join(' · ')].filter(Boolean).join(' '))
}

/** The summary block, line by line. */
function renderSummary(parts: PanelParts, words: PanelWords, s: Summary, budgetMs: number) {
  const { word, labelOf } = words
  const values = {
    frame: s.frameMs,
    gpu: s.gpuMs,
    cpu: s.cpuMs,
    wait: s.waitMs,
    gpuIdle: s.gpuIdleMs,
  }
  for (const id of SUMMARY_LINES) {
    const entry = parts.lines[id]
    if (id === 'screen') {
      renderScreen(entry, words, s, budgetMs)
      continue
    }
    const { label, value, line } = entry
    const key = `summary.${id}`
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
}

/** The tabs of the sections the report holds; returns the open section (the viewer's tab, else the
 *  first). */
function renderTabs(
  parts: PanelParts,
  { word, labelOf }: PanelWords,
  sections: readonly StatsSection[],
  layout: Layout,
) {
  const section = sections.find((one) => one.id === layout.tab) ?? sections[0]
  for (const [id, button] of parts.tabButtons) {
    button.hidden = !sections.some((one) => one.id === id)
    button.setAttribute('aria-selected', String(id === section?.id))
    put(button, labelOf(`tab.${id}`))
    setTitle(button, word(`tab.${id}`, 'hint'))
  }
  return section
}

/** The line over the rows: the open section's name, total, unit and note. */
function renderSectionHead(
  parts: PanelParts,
  { labelOf }: PanelWords,
  section: StatsSection,
  locale: string | undefined,
) {
  put(parts.sectionName, labelOf(`tab.${section.id}`))
  put(parts.sectionTotal, format(section.total, section.unit, locale))
  put(parts.sectionUnit, UNIT_TEXT[section.unit])
  put(parts.sectionNote, section.includedIn === 'gpu' ? labelOf('shadows.included') : '')
}

/** What `createRenderer` draws with. */
interface RenderContext {
  parts: PanelParts
  words: PanelWords
  layout: Layout
  rows: RowList
  spark: ReturnType<typeof sparkline>
  /** Fits the open tab's columns once its rows are shown. */
  fit: () => void
}

/** The language numbers are written in: the page's. */
const localeNow = () => globalThis.document?.documentElement.lang || undefined

/**
 * The panel's drawing of one report: the header always; folded, nothing more. Open: the sparkline
 * and its budget, the summary, the tabs, the open section's line and its rows.
 */
export function createRenderer({ parts, words, layout, rows, spark, fit }: RenderContext) {
  return (report: StatsReport) => {
    const { summary: s, sections } = report
    const locale = localeNow()
    const budgetMs = s.refreshMs ?? FALLBACK_REFRESH_MS
    renderHeader(parts, words, s, budgetMs)
    parts.panel.removeAttribute('data-empty')
    if (layout.compact) return
    spark.draw(budgetMs)
    put(parts.budget, ` ${words.labelOf('summary.budget')} ${format(budgetMs, 'ms')}`)
    renderSummary(parts, words, s, budgetMs)
    const section = renderTabs(parts, words, sections, layout)
    parts.sectionHead.hidden = parts.rowsBox.hidden = !section
    if (!section) return
    renderSectionHead(parts, words, section, locale)
    rows.show(section, locale)
    fit()
  }
}
