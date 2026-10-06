// #1369: the whole frame of the boss's case, counted stage by stage and priced at stated rates: every
// stage the profile names has its row, each row its count times its rate, and the frame their sum.
import test from 'node:test'
import assert from 'node:assert/strict'
import { frameBudget } from './frameBudget.ts'
import {
  FRAME_RATES,
  SPONZA_TRIANGLES,
  UNCOUNTED,
  atriumBenchLamps,
  hizAccesses,
} from './frameBudgetRates.ts'

test('the bench lamps over the atrium: 200 on a grid two metres up, a range of 0.75 cell', () => {
  const lamps = atriumBenchLamps()
  assert.equal(lamps.length, 200)
  assert.ok(lamps.every((l) => l.centre[1] === 2 && l.radius === lamps[0].radius))
  assert.ok(Math.abs(lamps[0].radius - 0.75 * Math.hypot(30.6 / 20, 14.6 / 10)) < 1e-5)
})

test('the Hi-Z pyramid: the copy of level 0, then four reads and a write a coarser texel', () => {
  assert.equal(hizAccesses(1, 1), 2)
  assert.equal(hizAccesses(4, 4), 32 + 5 * 4 + 5)
  assert.equal(hizAccesses(3, 1), 6 + 5 * 2 + 5)
})

test('every stage has its rows, each its count at its rate, the frame their sum', () => {
  const { rows, total, covered } = frameBudget(1, 432, 279)
  const stages = new Set(rows.map((row) => row.stage))
  for (const stage of ['visibility', 'materials', 'lighting', 'shadows', 'antialiasing', 'present'])
    assert.ok(stages.has(stage), stage)
  assert.ok(covered > 0.9 * 432 * 279)
  assert.ok(Math.abs(total - rows.reduce((sum, row) => sum + row.ms, 0)) < 1e-12)
  const clear = rows.find((row) => row.work.startsWith('clear'))!
  assert.equal(clear.count, 2 * 432 * 279)
  assert.ok(Math.abs(clear.ms - (clear.count * FRAME_RATES.texelPs) / 1e9) < 1e-12)
  const triangles = rows.find((row) => row.work === 'triangles')!
  assert.equal(triangles.count, SPONZA_TRIANGLES)
  assert.ok(rows.every((row) => row.ms >= 0 && Number.isFinite(row.ms)))
  assert.ok(Math.abs(FRAME_RATES.trianglePs - 53.24) < 1e-9, "UE5's 1,331 µs for 25 million")
  assert.ok(
    UNCOUNTED.some((what) => what.includes('shadow passes')),
    'what is not counted is named',
  )
})
