// A bench report as Markdown: what was played and how, each segment's frame (GPU, CPU, hitches,
// stability, same images), its GPU by stage and pass and its commands, the CPU by engine step and
// by function, the engine's counters, and what went wrong.
import { MIB } from '../../packages/math/src/constants.ts'
import { REFRESH_MS } from './frames.ts'
import type { BenchReport } from './merge.ts'
import type { Spread } from './summary.ts'

export const ms = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
const range = (s: Spread | null) => (s ? `${ms(s.median)} (${ms(s.min)}–${ms(s.max)})` : '—')
export const percent = (share: number | null) =>
  share === null ? '—' : `${(share * 100).toFixed(1)} %`
export const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

/** The frames per second a GPU time allows on a 120 Hz display, a frame that misses its refresh
 *  waiting for the next: the GPU alone, the browser's compositing not counted. */
const perSecond = (spanMs: number | null | undefined) =>
  spanMs ? (1000 / (Math.ceil(spanMs / REFRESH_MS - 1e-9) * REFRESH_MS)).toFixed(0) : '—'

type Segment = BenchReport['segments'][number]
/** Whether a segment's plays drew the same images: `—` when no two were compared. */
export const sameImages = (segment: Segment) =>
  segment.sameImages.length === 0
    ? '—'
    : segment.sameImages.every((d) => d && d.pixels === 0)
      ? 'identical'
      : segment.sameImages.map((d) => (d ? `${d.pixels} px` : '?')).join(', ')

/** One measured segment's GPU by pass on the bench's timer, the engine's own stages, and its
 *  commands per frame. */
function segmentDetail(segment: Segment) {
  const { passes, benchPasses, counts } = segment
  return [
    `### ${segment.name}`,
    '',
    `GPU by kind of pass: compute shaders ${ms(segment.computeMs?.median)} ms · drawing ${ms(segment.renderMs?.median)} ms.`,
    '',
    table(
      ['pass (bench timer, every pass)', 'kind', 'stage', 'median ms', 'p95 ms', 'share'],
      benchPasses
        .filter((pass) => pass.median >= 0.01 || pass.p95 >= 0.05)
        .slice(0, 30)
        .map((pass) => [
          pass.name,
          pass.kind,
          pass.stage,
          ms(pass.median, 3),
          ms(pass.p95, 3),
          percent(pass.share),
        ]),
    ),
    '',
    `Engine timer by stage (${passes.samples} sampled images): ` +
      passes.stages.map((stage) => `${stage.stage} ${ms(stage.median)}`).join(' · '),
    '',
    ...(segment.hitches.length
      ? [
          table(
            [
              'hitch (first play)',
              'frame ms',
              'CPU ms',
              'GPU ms',
              'pipelines made',
              'buffers made',
              'textures made',
              'uploaded',
            ],
            segment.hitches
              .slice(0, 12)
              .map((h) => [
                `frame ${h.frame}`,
                ms(h.wallMs),
                ms(h.cpuMs),
                ms(h.gpuMs),
                h.pipelinesMade,
                `${h.buffersMade} (${(h.bufferBytesMade / MIB).toFixed(2)} MiB)`,
                h.texturesMade,
                `${(h.writtenBytes / MIB).toFixed(2)} MiB`,
              ]),
          ),
          '',
        ]
      : []),
    'Commands per frame: ' +
      Object.entries(counts)
        .map(([key, value]) =>
          key.endsWith('Bytes') ? `${key} ${(value / MIB).toFixed(3)} MiB` : `${key} ${value}`,
        )
        .join(' · '),
    '',
  ]
}

export function reportText(report: BenchReport) {
  const { bench } = report
  // A play the other programs kept the GPU busy around (`gpuBusy.ts`) is marked disturbed.
  const busy = report.gpuBusy
    .map((b) =>
      b.before
        ? `${b.before.median}→${b.after?.median ?? '?'} %${b.before.busy || b.after?.busy ? ' DISTURBED' : ''}`
        : '?',
    )
    .join(', ')
  const measured = report.segments.filter((segment) => segment.measured)
  const engine = report.engine as Record<string, unknown>
  const lines = [
    `# GPU bench — ${bench.page}, scenario ${bench.scenario}${bench.switches.length ? ` (${bench.switches.join(', ')})` : ''}`,
    '',
    `${bench.title} · engine ${bench.engine} at ${bench.commit.slice(0, 10)} “${bench.subject}”${bench.dirty ? ` with ${bench.dirty} UNCOMMITTED files` : ''} · ${bench.date} · ${bench.gpu} · Node ${bench.node} (Dawn, no browser)`,
    `Profile ${bench.profile}${bench.featuresOff.length ? ` without ${bench.featuresOff.join(', ')}` : ''}: ` +
      `display ${bench.display.width}×${bench.display.height} (density ${bench.display.ratio}), scale ${bench.scale}; ` +
      `${report.plays} plays in fresh processes. GPU taken by other programs, before→after each play: ${busy}.`,
    `Calibration copy ${range(report.calibration)} ms (${ms(report.gbPerSecond?.median, 0)} GB/s); ready after ${range(report.readySeconds)} s.`,
    '',
    '## Segments',
    '',
    table(
      [
        'segment',
        'GPU ms (plays)',
        'fps at 120 Hz',
        'engine GPU ms',
        'main thread ms',
        'frame ms',
        'worst GPU · main thread ms',
        'hitches (frame)',
        'plays agree',
        'images',
        'drew',
      ],
      report.segments.map((s) => [
        s.measured ? s.name : `${s.name} (unmeasured)`,
        range(s.gpuMs),
        perSecond(s.gpuMs?.median),
        ms(s.engineGpuMs?.median),
        ms(s.cpuMs?.median),
        ms(s.wallMs?.median),
        `${ms(s.worstGpuMs)} · ${ms(s.worstCpuMs)}`,
        s.hitchFrames
          .map((at) => (at.length ? `${at.length} at ${at.slice(0, 6).join(',')}` : '0'))
          .join(' · '),
        `${percent(s.spread)} ${s.stable ? 'STABLE' : 'UNSTABLE'}`,
        sameImages(s),
        s.drawn.join(' · ') +
          (s.heldFrom.some((at) => at !== null) ? `, held from ${s.heldFrom.join(' · ')}` : ''),
      ]),
    ),
    '',
    'GPU: every pass of the frame timed on the GPU by the bench, overlaps once. Engine GPU: the engine’s own timer. Main thread: busy over the frame, long tasks after the image included — in Node it also holds Dawn waiting for the GPU, so read the engine’s own CPU in the function profile. Frame: the frame’s window, each frame waited for. Hitch: a frame twice the median.',
    '',
    '## GPU by segment',
    '',
    ...measured.flatMap(segmentDetail),
    '## CPU by engine step (profiled play)',
    '',
    report.cpuSteps
      ? '```\n' + JSON.stringify(report.cpuSteps, null, 1).slice(0, 4000) + '\n```'
      : 'Not profiled (`--cpu-profile`).',
    '',
    '## CPU by function (V8 samples, profiled play)',
    '',
    report.cpu
      ? table(
          ['function', 'where', 'self ms', 'total ms'],
          report.cpu.slice(0, 40).map((f) => [f.name, f.where, ms(f.selfMs, 1), ms(f.totalMs, 1)]),
        )
      : 'Not profiled (`--cpu-profile`).',
    '',
    '## Engine counters (last frame of the first play)',
    '',
    Object.entries(engine)
      .filter(([, value]) => typeof value === 'number' && value !== 0)
      .map(
        ([key, value]) =>
          `${key} ${key.endsWith('Bytes') ? `${((value as number) / MIB).toFixed(2)} MiB` : ms(value as number, 3)}`,
      )
      .join(' · '),
    '',
    '## Images',
    '',
    ...report.segments.flatMap((s) =>
      s.images.filter(Boolean).map((path) => `- ${s.name}: ${path}`),
    ),
    '',
    '## Errors',
    '',
    report.errors.length ? report.errors.map((error) => `- ${error}`).join('\n') : 'None.',
    '',
  ]
  return lines.join('\n')
}
