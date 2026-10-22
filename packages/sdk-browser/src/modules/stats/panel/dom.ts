import type { StatsUnitKind } from '../../../../../sdk-core/src/modules/stats/counters.ts'
import type { StatsRow } from '../../../../../sdk-core/src/modules/stats/report.ts'
import { BUDGET_COLOUR, CPU_COLOUR, GPU_COLOUR } from './style.ts'

/** An element of `tag` with `className`, its text `text`. */
export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

/** Writes `text` only when it changed: the panel never relays out for an equal number. */
export function put(element: Node, text: string) {
  if (element.textContent !== text) element.textContent = text
}

/** Sets `element`'s class only when it changed. */
export function setClass(element: Element, className: string) {
  if (element.className !== className) element.className = className
}

/** Sets `element`'s `title` only when it changed; an empty title removes the attribute, so a row
 *  without a hint never keeps another's. */
export function setTitle(element: HTMLElement, title: string) {
  if (element.getAttribute('title') === (title || null)) return
  if (title) element.setAttribute('title', title)
  else element.removeAttribute('title')
}

/** `fps` and `ms` coloured against the budget: green within it, orange within two, red beyond. */
export function tone(frameMs: number | null, budgetMs: number) {
  if (frameMs == null) return ''
  if (frameMs <= budgetMs + 0.05) return 't3s-ok'
  if (frameMs <= budgetMs * 2 + 0.05) return 't3s-warn'
  return 't3s-bad'
}

const DIGITS: Record<StatsUnitKind, number> = { ms: 2, MiB: 1, count: 0, '%': 0 }

/** The unit's text by kind; a count has none. */
export const UNIT_TEXT: Record<StatsUnitKind, string> = {
  ms: 'ms',
  MiB: 'MiB',
  count: '',
  '%': '%',
}

/** One number format per language, made once; the browser's own for a language it does not know. */
const FORMATS = new Map<string | undefined, Intl.NumberFormat>()
const formatOf = (locale: string | undefined) => {
  let found = FORMATS.get(locale)
  if (!found) {
    try {
      found = new Intl.NumberFormat(locale)
    } catch {
      found = new Intl.NumberFormat()
    }
    FORMATS.set(locale, found)
  }
  return found
}

/** A value as the panel shows it: `—` when it was not measured; a count is grouped with the
 *  separators of `locale` (the page's language, the browser's when absent or unknown). */
export function format(value: number | null, unit: StatsUnitKind, locale?: string) {
  if (value == null || Number.isNaN(value)) return '—'
  if (unit !== 'count') return value.toFixed(DIGITS[unit])
  return formatOf(locale).format(Math.round(value))
}

/** The sparkline's legend: its two lines (named `gpu` and `cpu`) and the budget's, whose text the
 *  panel rewrites. */
export function makeLegend(gpu: string, cpu: string) {
  const legend = make('div', 't3s-legend')
  const entry = (colour: string, text: string | Text) => {
    const key = make('span')
    const swatch = make('i')
    swatch.style.background = colour
    key.append(swatch, text)
    legend.append(key)
  }
  entry(GPU_COLOUR, gpu)
  entry(CPU_COLOUR, cpu)
  const budget = document.createTextNode('')
  entry(BUDGET_COLOUR, budget)
  return { legend, budget }
}

/** A row of a tab: its label, value, max of the second, unit and bar. */
export function makeRow(section: string, foldKey: string) {
  const row = make('div', 't3s-row')
  row.dataset.sec = section
  row.dataset.key = foldKey
  row.append(make('span'), make('span'), make('span'), make('span'), make('i', 't3s-bar'))
  return row
}

/** What a row shows of `row`: its text, its max, its bar; `fold` is `open`, `closed` or none. */
export function fillRow(
  element: HTMLElement,
  row: StatsRow,
  label: string,
  hint: string,
  fold: 'open' | 'closed' | null,
  depth: number,
  maxWord: string,
  locale?: string,
) {
  const [name, value, max, unit, bar] = Array.from(element.children) as HTMLElement[]
  setClass(element, `t3s-row${row.remainder ? ' t3s-rem' : ''}${depth ? ' t3s-child' : ''}`)
  if (fold) {
    if (element.dataset.fold !== fold) element.dataset.fold = fold
  } else if (element.dataset.fold !== undefined) delete element.dataset.fold
  setTitle(element, hint)
  put(name, label)
  // A profile row shows its median and its 95th percentile.
  put(
    value,
    row.p95 === undefined
      ? format(row.value, row.unit, locale)
      : `${format(row.value, row.unit, locale)} / ${format(row.p95, row.unit, locale)}`,
  )
  put(max, row.max == null ? '' : `${maxWord} ${format(row.max, row.unit, locale)}`)
  put(unit, UNIT_TEXT[row.unit])
  const scale = `scaleX(${row.share == null ? 0 : row.share.toFixed(3)})`
  if (bar.style.transform !== scale) bar.style.transform = scale
}
