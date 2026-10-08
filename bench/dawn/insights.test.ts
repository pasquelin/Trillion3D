import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchPass } from './benchPasses.ts'
import { buildInsights } from './insights.ts'
import type { Machine } from './machine.ts'
import { emptyWork } from './passWorkHooks.ts'

const machine = {
  readGBs: 400,
  writeGBs: 400,
  textureReadGBs: 500,
  textureWriteGBs: 300,
  attachmentGBs: 800,
  threadsPerMs: 1e8,
  passMs: 0.002,
  dispatchMs: 0.0015,
  barrierMs: 0.0005,
} as Machine
const pass = (name: string, median: number, waitMs = 0, stage = 'other') =>
  ({
    name,
    stage,
    kind: 'compute',
    median,
    waitMs,
    share: 0.1,
    encoded: { ...emptyWork(), calls: 1, groups: 1000, invocations: 1e5 },
  }) as BenchPass
const segment = (name: string, benchPasses: BenchPass[], engine = {}) =>
  ({ name, measured: true, benchPasses, engine }) as never

test('a run’s top gains are means over every segment, each row the segment where the pass gives most', () => {
  const { top, segments } = buildInsights(
    {
      machine,
      segments: [
        segment('a', [pass('waits', 0.2, 0.8)]),
        segment('b', [pass('waits', 0.2, 0)]),
        segment('c', []),
      ],
    },
    new Map(),
  )
  assert.equal(top[0].cause, 'wait', 'the cause is the segment’s where the pass waits')
  const [a, b] = segments.map((s) => s.ranking[0])
  assert.ok(
    Math.abs(top[0].gainMs - (a.waitMs + b.gainMs) / 3) < 1e-9,
    'its figure the mean of what each of the three segments gives, the empty one nothing',
  )
  assert.ok(Math.abs(top[0].waitMs - 0.8 / 3) < 1e-9)
})

test('each segment is judged on its own engine counters', () => {
  const transparents = { ...pass('transparents', 0.4, 0, 'transparents') }
  const { segments } = buildInsights(
    {
      machine,
      segments: [
        segment('empty', [transparents], { transparentMeshes: 0 }),
        segment('full', [transparents], { transparentMeshes: 6 }),
      ],
    },
    new Map(),
  )
  assert.equal(segments[0].ranking[0].cause, 'wasted work')
  assert.notEqual(segments[1].ranking[0].cause, 'wasted work')
})
