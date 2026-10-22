import type { StatsRow } from '../../../../../sdk-core/src/modules/stats/report.ts'
import {
  statsPassWord,
  statsWord,
  type StatsWords,
} from '../../../../../sdk-core/src/modules/stats/words.ts'

/**
 * The panel's words: one lookup per key for the panel's life, the page's `words` over the module's
 * own. `word` is a key's label or hint, `labelOf` a label (a raw key is its own), `passWord` a GPU
 * pass named by its engine label (shortened, then in the page's words), `rowLabel` the label of a
 * row, whose numbered key (`page.view.<index>`) takes its words from the key without the index.
 */
export function panelWords(words: StatsWords | undefined) {
  const byKey = new Map<string, { label: string; hint: string }>()
  const word = (key: string, field: 'label' | 'hint') => {
    let entry = byKey.get(key)
    if (!entry) byKey.set(key, (entry = statsWord(key, words)))
    return entry[field]
  }
  const labelOf = (key: string, raw?: boolean) => (raw ? key : word(key, 'label'))
  const passes = new Map<string, { label: string; hint: string }>()
  const passWord = (name: string) => {
    let entry = passes.get(name)
    if (!entry) passes.set(name, (entry = statsPassWord(name, words)))
    return entry
  }
  const rowKey = (row: StatsRow) =>
    row.n === undefined ? row.key : row.key.slice(0, row.key.lastIndexOf('.'))
  const rowLabel = (row: StatsRow) =>
    row.n === undefined
      ? labelOf(row.key, row.raw)
      : labelOf(rowKey(row)).replace('{n}', String(row.n))
  return { word, labelOf, passWord, rowKey, rowLabel }
}

export type PanelWords = ReturnType<typeof panelWords>
