// A segment's detail in a bench report: its frame, its doubts, its passes, its hitches and commands.
import type { BenchReport } from './merge.ts'
import { ms, percent, table } from './reportText.ts'

type Segment = BenchReport['segments'][number]

/** One measured segment's GPU by pass on the bench's timer, the engine's own stages, and its
 *  commands per frame. */
export function segmentDetail(segment: Segment) {
  const { passes, benchPasses, counts } = segment
  return [
    `### ${segment.name}`,
    '',
    `GPU by kind of pass: compute shaders ${ms(segment.computeMs?.median)} ms · drawing ${ms(segment.renderMs?.median)} ms.`,
    '',
    segment.frame
      ? `Frame over all ${segment.frame.n} timed frames: median ${ms(segment.frame.median)} · p95 ${ms(segment.frame.p95)} · min ${ms(segment.frame.min)} · max ${ms(segment.frame.max)} · middle half ${ms(segment.frame.iqr)} · std ${ms(segment.frame.std)} ms. GPU idle between passes ${ms(segment.idleMs?.median)} ms.`
      : '',
    '',
    segment.doubts.length
      ? 'TIMER DOUBTFUL:\n' + segment.doubts.map((doubt) => `- ${doubt}`).join('\n')
      : 'Timers coherent: no pass reads zero or lost, the passes add up to the frame, the engine agrees.',
    '',
    table(
      [
        'pass (bench timer, every pass)',
        'kind',
        'stage',
        'work median ms',
        'p95 ms',
        'share',
        'wait before ms',
        'span ms',
        'timer',
      ],
      benchPasses
        .filter((pass) => pass.median >= 0.01 || pass.p95 >= 0.05 || pass.doubtful)
        .slice(0, 40)
        .map((pass) => [
          pass.name,
          pass.kind,
          pass.stage,
          ms(pass.median, 3),
          ms(pass.p95, 3),
          percent(pass.share),
          ms(pass.waitMs, 3),
          ms(pass.spanMs, 3),
          pass.lost ? `LOST ${pass.lost}` : pass.empty ? `empty ${pass.empty}` : 'ok',
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
                `${h.buffersMade} (${(h.bufferBytesMade / 1048576).toFixed(2)} MiB)`,
                h.texturesMade,
                `${(h.writtenBytes / 1048576).toFixed(2)} MiB`,
              ]),
          ),
          '',
        ]
      : []),
    'Commands per frame: ' +
      Object.entries(counts)
        .map(([key, value]) =>
          key.endsWith('Bytes') ? `${key} ${(value / 1048576).toFixed(3)} MiB` : `${key} ${value}`,
        )
        .join(' · '),
    '',
  ]
}
