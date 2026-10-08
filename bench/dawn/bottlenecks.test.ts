import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchPass } from './benchPasses.ts'
import { floorsOf, rankBottlenecks, topGains } from './bottlenecks.ts'
import type { Machine } from './machine.ts'
import { emptyWork } from './passWorkHooks.ts'

const machine: Machine = {
  version: 2,
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
}
const pass = (name: string, median: number, extra: Partial<BenchPass> & { work?: object } = {}) =>
  ({
    name,
    stage: 'other',
    kind: 'compute',
    median,
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
  assert.ok(by.mystery.certainMs <= by.mystery.gainMs)
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
