// What a run tells of where its milliseconds go: each measured segment's passes ranked against the
// machine's floors, and the five biggest gains the whole run holds — each with its ms, its pass, its
// file:line and the cause the numbers prove. Built from the merged report, the machine's limits
// and the engine's own sources: no number here that was not measured or read.
import type { Bottleneck } from './bottlenecks.ts'
import { rankBottlenecks, topGains } from './bottlenecks.ts'
import type { BenchReport } from './merge.ts'
import type { PassSource } from './passSource.ts'
import { mib, ms, table } from './reportText.ts'

export type Insights = {
  segments: { name: string; ranking: Bottleneck[]; top: Bottleneck[] }[]
  /** The run's five biggest gains: a pass's gain averaged over the measured segments. */
  top: Bottleneck[]
}

/** The ranking of every measured segment, and the run's top gains. */
export function buildInsights(
  report: Pick<BenchReport, 'machine' | 'segments' | 'engine'>,
  sources: ReadonlyMap<string, PassSource>,
): Insights {
  const counters = report.engine as Record<string, unknown>
  const segments = report.segments
    .filter((segment) => segment.measured)
    .map((segment) => {
      const ranking = rankBottlenecks(segment.benchPasses, report.machine, counters, sources)
      return { name: segment.name, ranking, top: topGains(ranking) }
    })
  // A pass a segment lacks gave nothing there: every figure is a mean over all the segments.
  const total = new Map<string, Bottleneck>()
  for (const { ranking } of segments)
    for (const b of ranking) {
      const gain = b.cause === 'wait' ? b.waitMs : b.gainMs
      const held = total.get(b.name)
      if (!held) total.set(b.name, { ...b, gainMs: gain })
      else {
        held.gainMs += gain
        held.certainMs += b.certainMs
        held.workMs += b.workMs
      }
    }
  const averaged = [...total.values()].map((b) => ({
    ...b,
    gainMs: b.gainMs / segments.length,
    certainMs: b.certainMs / segments.length,
    workMs: b.workMs / segments.length,
  }))
  return { segments, top: averaged.sort((a, b) => b.gainMs - a.gainMs).slice(0, 5) }
}

const where = (b: Bottleneck) =>
  b.source
    ? `${b.source.file}:${b.source.line}${b.source.fn ? ` (${b.source.fn})` : ''}`
    : 'not found'

/** The head of the report: the five gains, then each segment's ranking. */
export function insightsText(insights: Insights, machine: BenchReport['machine']) {
  return [
    '## The five biggest gains',
    '',
    `Machine: reads ${ms(machine.readGBs, 0)} GB/s, writes ${ms(machine.writeGBs, 0)}, stores an attachment ${ms(machine.attachmentGBs, 0)}; a pass costs ${ms(machine.passMs * 1000, 1)} µs, a barrier ${ms(machine.barrierMs * 1000, 1)} µs, ${ms(machine.threadsPerMs / 1e6, 0)} M threads launch a ms.`,
    'Gain: ms the pass could save, at most (its work less its floor; a wait counts its idle) — and at least `certain`, if every byte it binds were moved.',
    '',
    table(
      ['#', 'gain ms (certain)', 'pass', 'where', 'cause', 'evidence'],
      insights.top.map((b, i) => [
        i + 1,
        `${ms(b.cause === 'wait' ? b.waitMs : b.gainMs)} (${ms(b.certainMs)})`,
        b.name,
        where(b),
        b.cause,
        b.evidence,
      ]),
    ),
    '',
    ...insights.segments.flatMap(({ name, ranking }) => [
      `### Bottlenecks, ${name}`,
      '',
      table(
        [
          'pass',
          'work ms',
          'wait ms',
          'floor ms',
          'gain ms',
          'cause',
          'groups',
          'threads',
          'bound MiB',
          'stored MiB',
          'where',
        ],
        ranking
          .filter((b) => b.workMs >= 0.01)
          .slice(0, 25)
          .map((b) => [
            b.name,
            ms(b.workMs, 3),
            ms(b.waitMs, 3),
            `${ms(b.floorMs, 3)}–${ms(b.floorMaxMs, 3)}`,
            ms(b.gainMs, 3),
            b.cause,
            b.encoded.groups || '—',
            b.encoded.invocations ? b.encoded.invocations.toExponential(1) : '—',
            mib(b.encoded.boundBytes),
            mib(b.encoded.attachBytes),
            where(b),
          ]),
      ),
      '',
    ]),
  ]
}
