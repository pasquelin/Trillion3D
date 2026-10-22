import { STATS_TABS, type StatsTab } from '../../../../../sdk-core/src/modules/stats/counters.ts'
import type { StatsReport } from '../../../../../sdk-core/src/modules/stats/report.ts'
import { make, makeLegend } from './dom.ts'
import type { Layout, SizeClass } from './layout.ts'
import type { PanelWords } from './panelWords.ts'
import { STYLE } from './style.ts'

/** The lines of the summary block, in order. */
export const SUMMARY_LINES = [
  'frame',
  'gpu',
  'cpu',
  'wait',
  'gpuIdle',
  'bottleneck',
  'screen',
] as const
export type SummaryLine = (typeof SUMMARY_LINES)[number]

/** What the panel keeps between ticks: its size class, the frame's size as the resize observer
 *  last reported it (a tick reads it, never the layout), and the last report (what a tab switch
 *  or a fold shows again without waiting for the next tick). */
export interface PanelState {
  size: SizeClass
  frameWidth: number
  frameHeight: number
  latest: StatsReport | null
}

/** The elements of the panel, made once and rewritten in place. */
export interface PanelParts {
  area: HTMLElement
  panel: HTMLElement
  head: HTMLElement
  dot: HTMLElement
  fps: HTMLElement
  frame: HTMLElement
  held: HTMLElement
  last: HTMLElement
  worldTag: HTMLElement
  cpuHead: HTMLElement
  gpuHead: HTMLElement
  sparkCanvas: HTMLCanvasElement
  budget: Text
  lines: Record<SummaryLine, { label: HTMLElement; value: HTMLElement; line: HTMLElement }>
  tabButtons: Map<StatsTab, HTMLButtonElement>
  sectionHead: HTMLElement
  sectionName: HTMLElement
  sectionTotal: HTMLElement
  sectionUnit: HTMLElement
  sectionNote: HTMLElement
  rowsBox: HTMLElement
}

/** The header line: the dot, the frames a second, the frame's time, the tags, the CPU and GPU times. */
function buildHead({ word, labelOf }: PanelWords) {
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
  return { head, dot, fps, frame, held, last, worldTag, cpuHead, gpuHead }
}

/** The summary block: one line (label, value) per `SUMMARY_LINES`. */
function buildSummary() {
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
  ) as unknown as PanelParts['lines']
  return { summary, lines }
}

/** The bar of tabs, every button hidden until a report holds its section. */
function buildTabs() {
  const tabs = make('div', 't3s-tabs')
  tabs.setAttribute('role', 'tablist')
  const tabButtons = new Map<StatsTab, HTMLButtonElement>()
  for (const id of STATS_TABS) {
    const button = make('button', 't3s-tab')
    button.type = 'button'
    button.setAttribute('role', 'tab')
    button.hidden = true
    tabButtons.set(id, button)
    tabs.append(button)
  }
  return { tabs, tabButtons }
}

/** The line over the rows: the open section's name, total, unit and note. */
function buildSectionHead() {
  const sectionHead = make('div', 't3s-sh')
  const sectionName = make('span'),
    sectionTotal = make('span'),
    sectionUnit = make('span'),
    sectionNote = make('span', 't3s-note')
  sectionHead.append(sectionName, sectionTotal, sectionUnit, sectionNote)
  return { sectionHead, sectionName, sectionTotal, sectionUnit, sectionNote }
}

/**
 * Makes the panel's elements in a frame over `parent`: the frame covers the view the panel sits
 * on. The body is the fixed block first (sparkline, legend, summary, tabs, section line), which
 * never moves when a tab or a fold changes, then the rows.
 */
export function buildPanel(parent: HTMLElement, words: PanelWords): PanelParts {
  const area = make('div', 't3s-frame')
  const style = make('style')
  style.textContent = STYLE
  area.append(style)
  parent.append(area)
  const panel = make('section', 't3s')
  panel.setAttribute('aria-label', words.word('panel.label', 'label'))
  panel.toggleAttribute('data-empty', true)
  const head = buildHead(words)
  const sparkCanvas = make('canvas', 't3s-spark')
  const { legend, budget } = makeLegend(
    words.labelOf('summary.gpuShort'),
    words.labelOf('summary.cpuShort'),
  )
  const { summary, lines } = buildSummary()
  const { tabs, tabButtons } = buildTabs()
  const section = buildSectionHead()
  const rowsBox = make('div')
  const fixedBlock = make('div', 't3s-fixed')
  fixedBlock.append(sparkCanvas, legend, summary, tabs, section.sectionHead)
  const body = make('div', 't3s-body')
  body.append(fixedBlock, rowsBox)
  panel.append(head.head, body)
  area.append(panel)
  return { area, panel, ...head, sparkCanvas, budget, lines, tabButtons, ...section, rowsBox }
}

/** Puts the viewer's corner and fold on the panel. */
export function applyLayout({ panel }: PanelParts, layout: Layout) {
  panel.dataset.corner = layout.corner
  panel.toggleAttribute('data-compact', layout.compact)
}
