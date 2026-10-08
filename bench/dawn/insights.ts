// What a run tells of where its milliseconds go: each measured segment's passes ranked against the
// machine's floors, and the five biggest gains the whole run holds — each with its ms, its pass, its
// file:line and the cause the numbers prove. Built from the merged report, the machine's limits
// and the engine's own sources: no number here that was not measured or read.
import type { Bottleneck } from './bottlenecks.ts'
import { gainOf, rankBottlenecks, topGains } from './bottlenecks.ts'
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
  report: Pick<BenchReport, 'machine' | 'segments'>,
  sources: ReadonlyMap<string, PassSource>,
): Insights {
  const segments = report.segments
    .filter((segment) => segment.measured)
    .map((segment) => {
      // The counters over the segment's own images: a pass is judged on what it drew.
      const ranking = rankBottlenecks(
        segment.benchPasses,
        report.machine,
        segment.counterMax,
        sources,
      )
      return { name: segment.name, ranking, top: topGains(ranking) }
    })
  // A pass a segment lacks gave nothing there: every figure is a mean over the segments that drew, and the
  // row (its cause, its evidence) is the segment's where the pass gives most.
  const total = new Map<
    string,
    { best: Bottleneck; at: string; gain: number; certain: number; work: number; wait: number }
  >()
  for (const { name, ranking } of segments)
    for (const b of ranking) {
      const held = total.get(b.name) ?? { best: b, at: name, gain: 0, certain: 0, work: 0, wait: 0 }
      if (gainOf(b) > gainOf(held.best)) {
        held.best = b
        held.at = name
      }
      held.gain += gainOf(b)
      held.certain += b.unexplainedMs
      held.work += b.workMs
      held.wait += b.waitMs
      total.set(b.name, held)
    }
  // A segment that drew nothing (a held image) has no pass to give: it is not one to divide by.
  const n = segments.filter(({ ranking }) => ranking.length).length || 1
  const averaged = [...total.values()].map(({ best, at, gain, certain, work, wait }) => ({
    ...best,
    // Its cause and evidence are the segment's where the pass gives most; its figures the mean.
    evidence: `[${at}] ${best.evidence}`,
    gainMs: gain / n,
    unexplainedMs: certain / n,
    workMs: work / n,
    waitMs: wait / n,
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
    `${machine.disturbed ? 'Machine measured while the GPU was busy with other programs (used for this run, not kept): ' : ''}Machine: reads ${ms(machine.readGBs, 0)} GB/s, writes ${ms(machine.writeGBs, 0)}, stores an attachment ${ms(machine.attachmentGBs, 0)}; a pass costs ${ms(machine.passMs * 1000, 1)} µs, a barrier ${ms(machine.barrierMs * 1000, 1)} µs, ${ms(machine.threadsPerMs / 1e6, 0)} M threads launch a ms.`,
    'Gain: the most the pass could give back, a mean over the segments (its work less its floor; a wait counts its idle). Unexplained: the part of its time that neither moving every byte it binds nor launching its threads can explain — compute or latency, for the shader to account for. Cause and evidence: the segment, in brackets, where the pass gives most.',
    '',
    table(
      ['#', 'gain ms at most (unexplained by bytes)', 'pass', 'where', 'cause', 'evidence'],
      insights.top.map((b, i) => [
        i + 1,
        `${ms(b.gainMs)} (${ms(b.unexplainedMs)})`,
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
