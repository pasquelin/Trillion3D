// Cut encoding contract: the NUMBER of commands a frame opens, sole cause of the wait timestamps
// attribute to no kernel. It depends NEITHER on hierarchy depth NOR on cluster count: one, always.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeDagKernels } from './encode.ts'
import { witnessEncoder, cutResources, LIVE, CAND, DRAWN } from './encode.fixture.ts'

test('a frame opens one command, whatever the depth', () => {
  // What the GPU pays between two kernels is counted in COMMANDS, not threads: each compute pass
  // and each copy outside a pass closes the current encoder and opens another. There used to be
  // 3·depth+3 — 42 on the bench's depth-thirteen hierarchy — because each level dispatched
  // indirectly and therefore had to arm its argument; then six, three arming copies cutting three
  // passes. Descent dispatches flat and the arming is a dispatch of the pass: one pass, period.
  for (const levelCount of [1, 3, 5]) {
    const { encoder, copies, passes } = witnessEncoder()
    encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources(levelCount))
    assert.deepEqual(passes, ['Trillion3D DAG selection'])
    assert.deepEqual(copies, [], 'nothing copied outside the pass')
  }
})

test('each list is armed in the pass after the kernel that fills it, before the one that walks it', () => {
  const { encoder, dispatches, armements, boundGroups } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources())
  const kernels = dispatches.map((l) => l.kernel)
  // Before the journal's clear (the previous frame's drawn count), after the descent (the
  // candidates), after `dagWanted` (the live clusters).
  assert.deepEqual(armements, [
    kernels.indexOf('dagClearDrawn'),
    kernels.indexOf('dagWanted'),
    kernels.indexOf('dagMask'),
  ])
  assert.deepEqual(
    dispatches.filter((l) => l.groups === 'indirect').map((l) => [l.kernel, l.list]),
    [
      ['dagClearDrawn', DRAWN],
      ['dagWanted', CAND],
      ['dagMask', LIVE],
      ['dagDrawScatter', LIVE],
    ],
  )
  // The arming group in place, then the selection's back before any kernel of the cut.
  const arm = boundGroups.flatMap((g, at) => ((g as { nom?: string }).nom ? [at] : []))
  assert.equal(arm.length, 3)
  for (const at of arm) assert.notEqual((boundGroups[at + 1] as { nom?: string }).nom, 'armGroup')
})

test('a flat dispatch past the device width runs in rows of it', () => {
  // Stages [2, 9, 40, 150, 600], capped at 1000 queued nodes: 1, 1, 1, 3 and 10 groups, on a
  // device four groups wide.
  const base = cutResources(5),
    device = { limits: { maxComputeWorkgroupsPerDimension: 4 } }
  const wide = { ...base, nodeCount: 1000, device } as unknown as typeof base
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, wide)
  const levels = dispatches
    .filter((l) => /^dag(Root)?Level/.test(l.kernel))
    .map((l) => `${l.groups}x${l.rows ?? 1}`)
  assert.deepEqual(levels.sort(), ['1x1', '1x1', '1x1', '3x1', '4x3'])
})

test('the camera cut sorts its requests once, then lists its evictions, one workgroup each', () => {
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources())
  const last = ['dagSortRequests', 'dagListEvictions']
  assert.deepEqual(
    dispatches.slice(-last.length),
    last.map((kernel) => ({ kernel, groups: 1 })),
  )
  assert.equal(dispatches.filter((l) => l.kernel === 'dagSortRequests').length, 1)
})
