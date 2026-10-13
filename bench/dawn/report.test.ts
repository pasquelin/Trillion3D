import assert from 'node:assert/strict'
import { test } from 'node:test'
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
