import { counterValue, sceneLines, shadowCounters, type StatsSample } from './statsLines.ts'
import { kitWord, labelOf } from './words.ts'

/** GPU passes named in the GPU section, the costliest first; the rest are summed as others. */
const GPU_ROWS = 6

export type SectionId = 'cadence' | 'cpu' | 'gpu' | 'shadows' | 'scene'
export const SECTIONS: readonly [SectionId, string][] = [
  ['cadence', 'Cadence'],
  ['cpu', 'CPU'],
  ['gpu', 'GPU'],
  ['shadows', 'Shadows'],
  ['scene', 'Scene and memory'],
]

/** One row: a label, a number, its unit, and the share of its section's total as a bar. */
export type Row = readonly [label: string, value: string, unit: string, share: number | null]

/** `12.83 ms` → `['12.83', 'ms']`; a bare number has no unit. */
function split(value: string): [string, string] {
  const at = value.lastIndexOf(' ')
  return at > 0 && /^[A-Za-z]+$/.test(value.slice(at + 1))
    ? [value.slice(0, at), value.slice(at + 1)]
    : [value, '']
}

/**
 * A pass as the engine names it, short: `Trillion3D temporal antialiasing v1` → `temporal
 * antialiasing`, `vsm.projection` → `vsm projection`, then in the page's language when the
 * examples' words have it (`kit.passes`).
 */
function passName(name: string): string {
  const short = name
    .replace(/^Trillion3D\s+/i, '')
    .replace(/\s+v\d+$/i, '')
    .replace(/[._-]+/g, ' ')
    .trim()
  return kitWord('passes', short, short)
}

/** A shadow counter's short name, its unit left to its value: `shadowVsmPagesCached` →
 *  `pagesCached`, in the page's language when the examples' words have it (`kit.shadows`), else
 *  humanised. */
function shadowName(key: string): string {
  const short = key.replace(/(Ms|Bytes)$/, '').replace(/^shadows?(Vsm)?/, '')
  const camel = short.charAt(0).toLowerCase() + short.slice(1)
  return kitWord('shadows', camel, labelOf(camel).toLowerCase())
}

/** A word of the corner in the page's language, `kit.stats.<key>`, the key itself when it has none. */
export const say = (key: string) => kitWord('stats', key, key)

/** The CPU rows: each stage by its share of the CPU frame, then a profile's own lines. */
export function cpuRows(sample: StatsSample, extra: readonly [string, string][]): Row[] {
  const total = sample.cpu?.frameMs ?? null
  const rows: Row[] = (sample.cpu?.stages ?? []).map(([name, value]) => [
    say(name),
    value.toFixed(2),
    'ms',
    total ? value / total : null,
  ])
  for (const [label, value] of extra) rows.push([say(label), ...split(value), null])
  return rows
}

/** The GPU rows: the costliest passes by their own share of the GPU frame, the rest as others. */
export function gpuRows(sample: StatsSample): Row[] {
  const passes = (sample.gpuPassMs?.passes ?? [])
    .map(({ name, gpuMs, ownMs }): [string, number] => [name, ownMs ?? gpuMs ?? 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
  const total = sample.gpuFrameMs || passes.reduce((sum, [, value]) => sum + value, 0) || null
  const share = (value: number) => (total ? Math.min(1, value / total) : null)
  const rows: Row[] = passes
    .slice(0, GPU_ROWS)
    .map(([name, value]) => [passName(name), value.toFixed(2), 'ms', share(value)])
  const rest = passes.slice(GPU_ROWS)
  if (rest.length) {
    const sum = rest.reduce((all, [, value]) => all + value, 0)
    rows.push([`${say('others')} (${rest.length})`, sum.toFixed(2), 'ms', share(sum)])
  }
  return rows
}

/** The shadow counters of one sample (`shadowCounters`), read once for its rows and its total. */
export type ShadowCounters = ReturnType<typeof shadowCounters>

/** The counters that are durations (`…Ms`): the shadows' GPU stages. */
const shadowTimes = (counters: ShadowCounters) => counters.filter(([key]) => key.endsWith('Ms'))

/** The shadow rows: GPU stages by their share of the GPU frame, the costliest first, then the
 *  counters in the engine's order, each printed by its unit (`counterValue`). */
export function shadowRows(sample: StatsSample, counters: ShadowCounters): Row[] {
  const total = sample.gpuFrameMs || null
  const row = ([key, value]: [string, number], share: number | null): Row => [
    shadowName(key),
    ...split(counterValue(key, value)),
    share,
  ]
  const times = shadowTimes(counters)
    .sort((a, b) => b[1] - a[1])
    .map((counter) => row(counter, total ? Math.min(1, counter[1] / total) : null))
  const counts = counters
    .filter(([key]) => !key.endsWith('Ms'))
    .map((counter) => row(counter, null))
  return [...times, ...counts]
}

/** The scene and memory rows: `sceneLines`, in the page's language. */
export const sceneRows = (sample: StatsSample): Row[] =>
  sceneLines(sample).map(([label, value]) => [say(label), ...split(value), null])

/** The sum shown on a section's header: the display's refresh, the CPU and GPU frames, the
 *  shadows' GPU time. */
export function sectionTotal(
  id: SectionId,
  sample: StatsSample,
  counters: ShadowCounters,
): [string, string] {
  if (id === 'cadence' && sample.cadence) return [sample.cadence.refreshMs.toFixed(2), 'ms']
  if (id === 'cpu' && sample.cpu?.frameMs != null) return [sample.cpu.frameMs.toFixed(2), 'ms']
  if (id === 'gpu' && sample.gpuFrameMs != null) return [sample.gpuFrameMs.toFixed(2), 'ms']
  if (id === 'shadows') {
    const time = shadowTimes(counters).reduce((sum, [, value]) => sum + value, 0)
    if (time > 0) return [time.toFixed(2), 'ms']
  }
  return ['', '']
}
