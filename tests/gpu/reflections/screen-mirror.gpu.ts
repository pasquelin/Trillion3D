// Screen mirrors in the real engine (`screenMirrorPage.ts`): a tilted metal plane, opaque or
// transparent, seen in perspective or orthographic, with bounce off and on, reflects two emissive
// sources where the analytic mirror puts them (`screenMirrorScene.ts`); a rough plane reflects
// neither, a moved source leaves no old reflection, an offscreen one none, and a resized view
// keeps the reflection that did not move.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/screen-mirror.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  runPageProof as runPage,
  assertSoundProof as assertHealthy,
} from '../kit/enginePageProof.ts'
import type { MirrorCase } from './screenMirrorPage.ts'

/** Whether `rgb` carries `channel`: bright, and well above the two others. */
const carries = (rgb: number[], channel: number) =>
  rgb[channel] > 50 && rgb[channel] > Math.max(...rgb.filter((_, k) => k !== channel)) + 30

test('a mirror reflects its sources where the analytic mirror does, and forgets them', async () => {
  const page = resolve(import.meta.dirname, 'screenMirrorPage.ts')
  const result = await runPage(page, 'screenMirror', 'run')
  assertHealthy(result)
  const { cases } = result as typeof result & { cases: MirrorCase[] }
  assert.equal(cases.length, 9, 'arrangements, alpha passes, camera projections and the bounce')
  for (const entry of cases) {
    const label = JSON.stringify(entry.options)
    for (const sequence of [entry.sharp, entry.transition, entry.rough]) {
      assert.equal(sequence.length, 4, label)
      for (const reading of sequence) assert.equal(reading.stable, 0, `${label}: stable A/A`)
    }
    for (const sequence of [entry.sharp, entry.transition]) {
      for (const step of [0, 1])
        for (const channel of [0, 1]) {
          assert.ok(carries(sequence[step].direct[channel], channel), `${label}: direct source`)
          assert.ok(carries(sequence[step].reflected[channel], channel), `${label}: reflection`)
          assert.ok(
            !carries(entry.rough[step].reflected[channel], channel),
            `${label}: a rough plane reflects no source`,
          )
        }
      assert.ok(!carries(sequence[1].old, 0), `${label}: a moved source leaves no reflection`)
      assert.ok(!carries(sequence[2].old, 0), `${label}: an offscreen source leaves none`)
      assert.ok(carries(sequence[2].reflected[1], 1), `${label}: the green reflection stays`)
      assert.ok(carries(sequence[3].reflected[1], 1), `${label}: and survives a resize`)
    }
  }
})
