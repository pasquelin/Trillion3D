// What the shadow views' descent asks of a node before it opens it (`traversalWgsl.ts`,
// `vsmDescentNotDrawn`) is what the cull asks of each cluster under it (`../render/renderCullWgsl.ts`):
// in the dynamic layer, the clip depths within the map's dynamic depth range; on a page to draw of the
// layer, over a receiver of the map's cover where the layer is not the static one. The node's box
// holds its clusters' boxes (so its clip depths reach as far as theirs, and the cube about its sphere
// doubled covers their pages and their cover cells), so no cluster the cull keeps is lost.

import test from 'node:test'
import assert from 'node:assert/strict'
import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import { stageBindingCounts } from '../../../../../../../tests/kit/fakeDevice/limitRules.ts'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { MOBILITY_MOVING, MOBILITY_OFFSET_INVALIDATES } from '../../mobilityBits.ts'
import { vsmDescentPipes } from './traversalPass.ts'
import { vsmDescentWgsl } from './traversalWgsl.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const DESCENT = vsmDescentWgsl(LAYOUT)
const C = wgslConstants(DESCENT)

/** `vsmDescentNotDrawn` over a placement of mobility `word`, its pages judged by `touches` (the
 *  mark mask asked, the cover asked), in a map with the dynamic depth range `range`, a cover
 *  (`useCover`) and the node box's clip depths 0.5 to 0.9. */
function notDrawn(
  word: number,
  touches: (markMask: number, useCover: boolean) => boolean,
  { range = [0, FLOAT32_MAX], useCover = false } = {},
) {
  const cube = { cube: true }
  const { vsmDescentNotDrawn } = shaderRun<{ vsmDescentNotDrawn(...a: unknown[]): boolean }>(
    DESCENT,
    ['vsmDescentNotDrawn'],
    {
      ...C,
      descentMip: () => 2,
      vsmRootCount: () => 8,
      vsmRootWords: () => ({ word, viewBits: 0, disableSq: 0, deformReach: 0 }),
      vsmDescentCube: () => cube,
      vsmStalePixels: () => [0, 0, 1, 1],
      vsmTouchesMappedPixels: (...a: unknown[]) => touches(a[3] as number, a[5] as boolean),
    },
  )
  const pd = { uncached: false, viewSlot: 0, dynamicDepthCullRange: range, useCover }
  const box = { cull: { clipLow: [0, 0, 0.5], clipHigh: [0, 0, 0.9] } }
  return vsmDescentNotDrawn(3, { id: 5 }, pd, box)
}

test('a node outside the map’s dynamic depth range is dropped in the dynamic layer, kept in the static one', () => {
  const pages = () => true
  const moving = MOBILITY_MOVING
  assert.equal(notDrawn(moving, pages), false, 'no limit: kept')
  assert.equal(
    notDrawn(moving, pages, { range: [0.9, FLOAT32_MAX] }),
    true,
    'far end at the near limit',
  )
  assert.equal(notDrawn(moving, pages, { range: [0.85, FLOAT32_MAX] }), false, 'far end past it')
  assert.equal(notDrawn(moving, pages, { range: [0, 0.5] }), true, 'near end at the far limit')
  assert.equal(notDrawn(moving, pages, { range: [0, 0.6] }), false, 'near end short of it')
  assert.equal(
    notDrawn(0, pages, { range: [0.9, FLOAT32_MAX] }),
    false,
    'a still placement: no cut',
  )
  // A still placement whose offset may invalidate draws its clusters that evaluate it in the dynamic
  // layer: the static layer keeps it, else the dynamic layer's range cuts it.
  const offset = MOBILITY_OFFSET_INVALIDATES
  const dynamicOnly = (mask: number) => mask === C.VSM_PAGE_DYNAMIC_STALE
  assert.equal(notDrawn(offset, dynamicOnly, { range: [0.95, FLOAT32_MAX] }), true, 'out of range')
  assert.equal(notDrawn(offset, dynamicOnly, { range: [0, FLOAT32_MAX] }), false, 'in range')
})

test('a node over pages the receiver cover leaves out is dropped in the dynamic layer of a cover map, kept otherwise', () => {
  // The pages exist, but the cover holds no receiver of them: they count only where the cover is asked.
  const uncovered = (_mask: number, useCover: boolean) => !useCover
  assert.equal(
    notDrawn(MOBILITY_MOVING, uncovered, { useCover: true }),
    true,
    'a cover map, dynamic',
  )
  assert.equal(notDrawn(MOBILITY_MOVING, uncovered), false, 'a map with no cover')
  assert.equal(notDrawn(0, uncovered, { useCover: true }), false, 'the static layer takes no cover')
  // The static placement's clusters that wear an offset are dynamic: the static layer keeps the node
  // where it has pages, else the dynamic layer's cover is asked.
  const staticPages = (mask: number) => mask === C.VSM_PAGE_STATIC_STALE
  assert.equal(notDrawn(MOBILITY_OFFSET_INVALIDATES, staticPages, { useCover: true }), false)
  const dynamicUncovered = (mask: number, useCover: boolean) =>
    mask === C.VSM_PAGE_DYNAMIC_STALE && !useCover
  assert.equal(
    notDrawn(MOBILITY_OFFSET_INVALIDATES, dynamicUncovered, { useCover: true }),
    true,
    'its dynamic clusters over uncovered pages',
  )
})

// The descent's group 1 holds the eight storage buffers a stage is sure to have, the receiver cover
// among them: the frame's lights reach the views kernel through the descent's `work`, not a buffer.
test('each kernel of the descent binds eight storage buffers at most, the receiver cover among them', () => {
  const fake = fakeDevice()
  const pipes = vsmDescentPipes(fake.device, LAYOUT)
  const entries = (groups: GPUBindGroupLayout[]) =>
    groups.flatMap((g) => [...((g as unknown as GPUBindGroupLayoutDescriptor).entries ?? [])])
  for (const pipe of [pipes.views, pipes.prepare, ...pipes.levels, pipes.postNodes, pipes.close]) {
    const storage = stageBindingCounts({ bindGroupLayouts: pipe.groups }).find(
      (c) => c.limit === 'maxStorageBuffersPerShaderStage' && c.kind.endsWith('Compute'),
    )
    assert.equal(storage?.count, 8)
  }
  const cover = entries(pipes.prepare.groups).find((e) => e.binding === 3 && e.buffer)
  assert.equal(cover?.buffer?.type, 'read-only-storage', 'binding 3 is the receiver cover')
})
