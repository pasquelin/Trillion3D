import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchPass } from './benchPasses.ts'
import { floorsOf, rankBottlenecks, topGains } from './bottlenecks.ts'
import type { Machine } from './machine.ts'
import { emptyWork } from './passWorkHooks.ts'

const machine: Machine = {
  version: 3,
  adapter: 'test',
  date: '',
  readGBs: 400,
  writeGBs: 400,
  textureReadGBs: 500,
  textureWriteGBs: 300,
  attachmentGBs: 800,
  threadsPerMs: 1e8,
  passMs: 0.002,
  dispatchMs: 0.0015,
  barrierMs: 0.0005,
  texelLoadG: 500,
  texelFilterG: 250,
  aluTflops: 20,
  sharedGBs: 4000,
  mrt4G: 25,
  fragmentsG: 100,
  trianglesG: 4,
}
const pass = (name: string, median: number, extra: Partial<BenchPass> & { work?: object } = {}) =>
  ({
    name,
    stage: 'other',
    kind: 'compute',
    median,
    mean: median,
    waitMs: 0,
    share: 0.1,
    encoded: { ...emptyWork(), calls: 1, groups: 1000, invocations: 256_000, ...extra.work },
    ...extra,
  }) as BenchPass

test('a floor is the larger of a pass’s fixed cost, its launch and its stores; the max moves every byte', () => {
  const f = floorsOf(
    pass('a', 1, { work: { invocations: 2e8, attachBytes: 0, boundBytes: 400e6 } }),
    machine,
  )
  assert.ok(Math.abs(f.floorMs - 2) < 1e-9, `launch of 2e8 threads is 2 ms: ${f.floorMs}`)
  assert.ok(Math.abs(f.moved - 1) < 1e-9, '400 MB at the slowest read rate, 400 GB/s: 1 ms')
})

test('the ranking sorts by work, names the cause the numbers prove, and bounds the gain', () => {
  const ranking = rankBottlenecks(
    [
      pass('waits', 1, { waitMs: 0.8 }),
      pass('streams', 3, { work: { boundBytes: 1.1e9 } }),
      {
        ...pass('stores', 2.5),
        kind: 'render',
        encoded: { ...emptyWork(), calls: 1, vertices: 3, attachBytes: 2e9 },
      } as BenchPass,
      pass('few', 0.5, { work: { groups: 4, invocations: 1024 } }),
      pass('mystery', 2),
    ],
    machine,
    {},
    new Map([['mystery', { file: 'a.ts', line: 3, fn: 'encode', shaders: [] }]]),
  )
  assert.deepEqual(
    ranking.map((r) => r.name),
    ['streams', 'stores', 'mystery', 'waits', 'few'],
  )
  assert.equal(
    ranking[1].cause,
    'bandwidth',
    'attachments stored are exact bytes: 2 GB at 800 GB/s is 2.5 ms',
  )
  const by = Object.fromEntries(ranking.map((r) => [r.name, r]))
  assert.equal(by.waits.cause, 'wait')
  assert.equal(by.streams.cause, 'unproven', 'bound bytes are a ceiling: they prove nothing')
  assert.match(by.streams.evidence, /bandwidth is possible/)
  assert.equal(by.few.cause, 'occupancy')
  assert.equal(by.mystery.cause, 'unproven')
  assert.equal(by.mystery.source?.file, 'a.ts')
  assert.ok(by.mystery.unexplainedMs <= by.mystery.gainMs)
})

test('a pass drawing nothing the engine counts is wasted work; the top gains put a wait at its idle', () => {
  const idle = rankBottlenecks(
    [{ ...pass('transparents', 0.4), stage: 'transparents', kind: 'render' } as BenchPass],
    machine,
    { transparentMeshes: 0 },
    new Map(),
  )
  assert.equal(idle[0].cause, 'wasted work')
  const ranking = rankBottlenecks(
    [pass('big', 0.5), pass('waits', 0.2, { waitMs: 0.9 })],
    machine,
    {},
    new Map(),
  )
  assert.equal(topGains(ranking, 1)[0].name, 'waits')
})

test('a pass that took no time is never bound by anything', () => {
  const [row] = rankBottlenecks([pass('nothing', 0)], machine, {}, new Map())
  assert.equal(row.cause, 'unproven')
  assert.match(row.evidence, /nothing to gain/)
})

test('an encoding the bench cannot size rules nothing out and explains nothing', () => {
  const [row] = rankBottlenecks(
    [pass('driven', 3, { work: { unsized: 4, invocations: 0, groups: 0 } })],
    machine,
    {},
    new Map(),
  )
  assert.equal(row.cause, 'unproven')
  assert.match(row.evidence, /cannot size/)
  assert.doesNotMatch(row.evidence, /ruled out:/)
  assert.equal(row.unexplainedMs, 0)
})

test('a render pass pays no dispatch cost in its floor', () => {
  const render = {
    ...pass('draws', 1),
    kind: 'render',
    encoded: { ...emptyWork(), calls: 1000 },
  } as BenchPass
  assert.equal(rankBottlenecks([render], machine, {}, new Map())[0].floorMs, machine.passMs)
})

test('indirect work beside a few direct groups is no proof of occupancy', () => {
  const [row] = rankBottlenecks(
    [pass('culls', 2, { work: { groups: 4, invocations: 1024, indirect: 3, unsized: 3 } })],
    machine,
    {},
    new Map(),
  )
  assert.notEqual(row.cause, 'occupancy')
})

test('a counter never seen says nothing: a pass is wasted only when its counter was zero', () => {
  const transparents = {
    ...pass('transparents', 0.4),
    stage: 'transparents',
    kind: 'render',
  } as BenchPass
  assert.notEqual(rankBottlenecks([transparents], machine, {}, new Map())[0].cause, 'wasted work')
  assert.equal(
    rankBottlenecks([transparents], machine, { transparentMeshes: 0 }, new Map())[0].cause,
    'wasted work',
  )
  const water = { ...pass('water surface', 0.4), stage: 'transparents' } as BenchPass
  assert.notEqual(
    rankBottlenecks([water], machine, { transparentMeshes: 0 }, new Map())[0].cause,
    'wasted work',
  )
})

test('a pass of many batches pays the fixed cost of each', () => {
  const [row] = rankBottlenecks(
    [pass('batched', 1, { work: { batches: 40, calls: 40 } })],
    machine,
    {},
    new Map(),
  )
  assert.ok(row.floorMs >= 40 * machine.passMs, `${row.floorMs}`)
})

test('a pass that runs on some frames only costs its mean, not the zero of its median', () => {
  const sometimes = { ...pass('sometimes', 0), mean: 1.5 } as BenchPass
  const [row] = rankBottlenecks([sometimes], machine, {}, new Map())
  assert.equal(row.workMs, 1.5)
  assert.notEqual(row.evidence, 'under 1 µs measured: nothing to gain')
})
