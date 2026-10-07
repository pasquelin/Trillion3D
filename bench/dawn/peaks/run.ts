// The GPU's measured peaks on Dawn, no browser: each micro-benchmark of `plan.ts` run alone on an
// idle queue, warmed, then timed by its pass's own timestamps. The floor of a frame's pass is its
// work over these rates (`../model/floor.ts`).
//   node bench/dawn/peaks/run.ts [--repeat 15]
// Waits for the machine's bench lock. The table, JSON and Markdown, lands in `.mesure/out/peaks/`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { measureOutput } from '../../core/paths.ts'
import { installDawn } from '../device.ts'
import { waitBenchLock } from '../lock.ts'
import { stamp } from '../options.ts'
import { table } from '../reportText.ts'
import { preparePeak } from './encode.ts'
import { peakPlan, rateOf, type PeakBench } from './plan.ts'

/** Runs before the timed ones: enough for the GPU's clock to rise from idle. */
const WARM = 6

/** The device the peaks run on: every limit the adapter grants, timestamps on. */
async function openDevice() {
  const adapter = await installDawn().requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter?.features.has('timestamp-query'))
    throw new Error('PEAKS_DEVICE: no adapter with timestamp queries')
  const limits = adapter.limits
  const device = await adapter.requestDevice({
    requiredFeatures: ['timestamp-query'],
    requiredLimits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  })
  return { device, adapter: adapter.info.description || adapter.info.architecture }
}

/** Times `bench` `repeat` times after `WARM` runs: each run's ms, on its pass's timestamps. */
async function timeBench(device: GPUDevice, bench: PeakBench, repeat: number) {
  device.pushErrorScope('validation')
  const prepared = preparePeak(device, bench)
  const set = device.createQuerySet({ type: 'timestamp', count: 2 })
  const resolved = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  })
  const read = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const refused = await device.popErrorScope()
  if (refused) throw new Error(`PEAKS_BENCH: ${bench.resource}: ${refused.message}`)
  const times: number[] = []
  for (let run = 0; run < WARM + repeat; run++) {
    await device.queue.onSubmittedWorkDone()
    const encoder = device.createCommandEncoder()
    prepared.encode(encoder, {
      querySet: set,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    })
    encoder.resolveQuerySet(set, 0, 2, resolved, 0)
    encoder.copyBufferToBuffer(resolved, 0, read, 0, 16)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const [begin, end] = new BigInt64Array(read.getMappedRange().slice(0))
    read.unmap()
    if (run >= WARM) times.push(Number(end - begin) / 1e6)
  }
  prepared.destroy()
  for (const held of [set, resolved, read]) held.destroy()
  return times.sort((a, b) => a - b)
}

async function main() {
  const { values } = parseArgs({ options: { repeat: { type: 'string', default: '15' } } })
  const repeat = Math.max(3, Number(values.repeat))
  const release = await waitBenchLock('GPU peaks')
  const { device, adapter } = await openDevice()
  const rows = []
  for (const bench of peakPlan()) {
    const times = await timeBench(device, bench, repeat)
    const median = times[times.length >> 1],
      best = times[0]
    rows.push({
      resource: bench.resource,
      unit: bench.unit,
      medianMs: median,
      bestMs: best,
      rate: rateOf(bench, median),
      bestRate: rateOf(bench, best),
    })
  }
  device.destroy()
  release()
  const out = measureOutput('peaks')
  mkdirSync(out, { recursive: true })
  const stem = join(out, `${stamp()}-peaks`)
  writeFileSync(`${stem}.json`, JSON.stringify({ adapter, repeat, rows }, null, 1))
  const text = [
    `# GPU peaks — ${adapter}, Dawn in Node, ${repeat} timed runs each`,
    '',
    table(
      ['resource', 'median ms', 'best ms', 'rate (median)', 'rate (best)', 'unit'],
      rows.map((r) => [
        r.resource,
        r.medianMs.toFixed(3),
        r.bestMs.toFixed(3),
        r.rate.toFixed(r.rate < 10 ? 3 : 1),
        r.bestRate.toFixed(r.bestRate < 10 ? 3 : 1),
        r.unit,
      ]),
    ),
    '',
  ].join('\n')
  writeFileSync(`${stem}.md`, text)
  console.log(text)
  console.log(`peaks: ${stem}.md`)
  process.exit(0)
}

await main()
