import type { StatsRow, StatsSection } from '../../../../../sdk-core/src/modules/stats/report.ts'
import { fillRow, makeRow } from './dom.ts'
import type { Layout } from './layout.ts'
import type { PanelWords } from './panelWords.ts'

/** A stage of one pass is that pass: it folds nothing. */
const folds = (row: StatsRow) => (row.children?.length ?? 0) > 1

/** The words of a row: its label, and its hint (a pass names its engine label; a stage of one pass
 *  shows that pass's name beside its own hint). `×n` when a pass sums n numbered passes of one family. */
function rowWords(row: StatsRow, depth: number, words: PanelWords) {
  const pass = depth > 0 && row.raw ? words.passWord(row.key) : null
  const only = row.children?.length === 1 ? words.passWord(row.children[0].key) : null
  const hint = pass ? pass.hint : words.word(words.rowKey(row), 'hint')
  const label = pass
    ? row.count && row.count > 1
      ? `${pass.label} ×${row.count}`
      : pass.label
    : words.rowLabel(row)
  return { label, hint: only?.hint ? `${hint} ${only.label}: ${only.hint}` : hint }
}

/**
 * The rows of the open tab in `rowsBox`: each an element made once, keyed by its section and key
 * (`<section>/<row>[/<pass>]`), and rewritten in place at each tick, never rebuilt. A stage of
 * several passes folds and unfolds them with a click (`layout.unfolded`).
 */
export function createRowList(rowsBox: HTMLElement, layout: Layout, words: PanelWords) {
  const elements = new Map<string, HTMLElement>()
  const maxWord = () => words.labelOf('row.max')

  /** Puts `row` (and, unfolded, its passes) at `order.index` of the box. */
  const putRow = (
    section: StatsSection,
    row: StatsRow,
    key: string,
    depth: number,
    order: { index: number; seen: Set<string> },
    locale: string | undefined,
  ) => {
    const folded = folds(row) ? (layout.unfolded[key] ? 'open' : 'closed') : null
    let element = elements.get(key)
    if (!element) {
      element = makeRow(section.id, key)
      elements.set(key, element)
    }
    order.seen.add(key)
    if (rowsBox.children[order.index] !== element)
      rowsBox.insertBefore(element, rowsBox.children[order.index] ?? null)
    order.index++
    const { label, hint } = rowWords(row, depth, words)
    fillRow(element, row, label, hint, folded, depth, maxWord(), locale)
    if (folded === 'open')
      for (const child of row.children!)
        putRow(section, child, `${key}/${child.key}`, depth + 1, order, locale)
  }

  return {
    /** Shows `section`'s rows in the report's order, and drops the elements of rows that are gone. */
    show(section: StatsSection, locale: string | undefined) {
      const order = { index: 0, seen: new Set<string>() }
      for (const row of section.rows)
        putRow(section, row, `${section.id}/${row.key}`, 0, order, locale)
      while (rowsBox.children.length > order.index) rowsBox.lastElementChild!.remove()
      for (const key of elements.keys()) if (!order.seen.has(key)) elements.delete(key)
    },
    /** The rows a section shows: its rows and the passes of its unfolded stages. */
    count: (section: StatsSection) =>
      section.rows.reduce(
        (count, row) =>
          count +
          1 +
          (folds(row) && layout.unfolded[`${section.id}/${row.key}`] ? row.children!.length : 0),
        0,
      ),
  }
}

export type RowList = ReturnType<typeof createRowList>
