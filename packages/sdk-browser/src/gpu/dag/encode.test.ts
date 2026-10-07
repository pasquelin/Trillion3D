// Cut encoding contract: the NUMBER of commands a frame opens, sole cause of the wait timestamps
// attribute to no kernel. It depends NEITHER on hierarchy depth NOR on cluster count: one, always.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeDagKernels } from './encode.ts'
import { witnessEncoder, cutResources, LIVE, CAND, DRAWN, QUEUE } from './encode.fixture.ts'

test('a frame opens one command, whatever the depth', () => {
  // What the GPU pays between two kernels is counted in COMMANDS, not threads: each compute pass
  // and each copy outside a pass closes the current encoder and opens another. A level dispatched
  // indirectly arms its argument by a dispatch of the pass, never a copy: one pass, period.
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
  // Before the journal's clear (the previous frame's drawn count), before level 2 (the queue level
  // 1 filled), after the descent (the candidates), after `dagWanted` (the live clusters).
  assert.deepEqual(armements, [
    kernels.indexOf('dagClearDrawn'),
    kernels.indexOf('dagLevel2'),
    kernels.indexOf('dagWanted'),
    kernels.indexOf('dagMask'),
  ])
  assert.deepEqual(
    dispatches.filter((l) => l.groups === 'indirect').map((l) => [l.kernel, l.list]),
    [
      ['dagClearDrawn', DRAWN],
      ['dagLevel2', QUEUE + 2],
      ['dagWanted', CAND],
      ['dagMask', LIVE],
      ['dagDrawScatter', LIVE],
    ],
  )
  // The arming group in place, then the selection's back before any kernel of the cut.
  const arm = boundGroups.flatMap((g, at) => ((g as { nom?: string }).nom ? [at] : []))
  assert.equal(arm.length, 4)
  for (const at of arm) assert.notEqual((boundGroups[at + 1] as { nom?: string }).nom, 'armGroup')
})

test('a level past the first is dispatched on what the level before it deposited', () => {
  // Stages [2, 9, 40, 150, 600]: past level 1, the bound would be every placement's nodes of the
  // level, the world's; each is dispatched on its queue's armed groups instead.
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources(5))
  const levels = dispatches.filter((l) => /^dag(Root)?Level/.test(l.kernel))
  assert.deepEqual(
    levels.map((l) => [l.kernel, l.groups === 'indirect' ? l.list : l.groups]),
    [
      ['dagRootLevel', 1],
      ['dagLevel1', 1],
      ['dagLevel2', QUEUE + 2],
      ['dagLevel0', QUEUE],
      ['dagLevel1', QUEUE + 1],
    ],
  )
})

test('a flat dispatch past the device width runs in rows of it', () => {
  // Level 1 of 1000 nodes, capped at 1000 queued nodes: 16 groups on a device four groups wide.
  const base = cutResources(2),
    device = { limits: { maxComputeWorkgroupsPerDimension: 4 } }
  const wide = {
    ...base,
    levelSizes: Uint32Array.of(2, 1000),
    nodeCount: 1000,
    device,
  } as unknown as typeof base
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, wide)
  const levels = dispatches
    .filter((l) => /^dag(Root)?Level/.test(l.kernel))
    .map((l) => `${l.groups}x${l.rows ?? 1}`)
  assert.deepEqual(levels, ['1x1', '4x4'])
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

test('with a placement tree, prepare and pass 0 run over its top and the world DAG, not the world', () => {
  // 100,000 placements in two ranges, the world DAG in the second: the tree's one top node and that
  // root, never a thread per placement.
  const base = cutResources(2),
    ranges = [0, 1].map((r) => ({ first: r * 65_536, count: r ? 34_464 : 65_536, bindGroup: {} }))
  const packed = { placementTree: { levels: [{ count: 1 }] }, world: { root: 70_000 } }
  const cut = { ...base, blockCount: 1, ranges, packed } as unknown as typeof base
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cut)
  const of = (kernel: string) => dispatches.filter((l) => l.kernel === kernel).map((l) => l.groups)
  assert.deepEqual(
    of('dagPrepare'),
    [1, 1],
    'the head range its top node, the world range its root',
  )
  assert.deepEqual(of('dagRootLevel'), [1, 1], 'each range reads those two entries')
})
