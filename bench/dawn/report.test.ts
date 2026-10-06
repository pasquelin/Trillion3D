import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pixelDifference } from './capture.ts'
import { functionTimes, type CpuProfile } from './cpuProfile.ts'

test('a function’s own time is the samples it was on top of; its total counts a recursion once', () => {
  const at = (functionName: string) => ({ functionName, url: '', lineNumber: 0 })
  // main → draw → draw (recursion) → shade; samples: shade, draw (inner), main.
  const profile: CpuProfile = {
    nodes: [
      { id: 1, callFrame: at('main'), children: [2] },
      { id: 2, callFrame: at('draw'), children: [3] },
      { id: 3, callFrame: at('draw'), children: [4] },
      { id: 4, callFrame: at('shade') },
    ],
    samples: [4, 3, 1],
    timeDeltas: [0, 2000, 3000, 1000],
  }
  const times = new Map(functionTimes(profile).map((time) => [time.name, time]))
  assert.equal(times.get('shade')!.selfMs, 2)
  assert.equal(times.get('draw')!.selfMs, 3)
  assert.equal(times.get('draw')!.totalMs, 5)
  assert.equal(times.get('main')!.totalMs, 6)
})

test('two images differ by the pixels whose colour changed, alpha aside', () => {
  const a = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255])
  const b = Uint8Array.from([1, 2, 3, 0, 4, 9, 6, 255])
  assert.deepEqual(pixelDifference(a, b), { pixels: 1, largest: 4 })
  assert.deepEqual(pixelDifference(a, a), { pixels: 0, largest: 0 })
})
