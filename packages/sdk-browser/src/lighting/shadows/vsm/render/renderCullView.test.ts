// The shadow raster's cull of a caster against the mip views of a map (`renderCullWgsl.ts`): what the
// first cull holds back, what the second and the post cull draw, the bin of a cluster and the previous
// box's projection.

import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { CULL, viewCull } from './renderCullView.fixture.ts'

// The first cull holds a caster back where the previous image drew it (the candidate's `prevShift`
// added to the centre it tests, its box under the previous pose), not where it is now: the one that moved from behind an occluder
// into the open is held, the one that stood in the open is drawn.
test('the first cull holds a moved caster where the previous image drew it, not where it is now', () => {
  // Hidden behind the previous image's pyramid for a centre left of 5: where the caster stood.
  const { run, held, drawn, caster, kind } = viewCull((centre) => centre[0] < 5)
  // At x = 10 now, at 0 before: tested at 0, hidden there, held — candidate 5, view 0.
  run.vsmRenderCullViews(caster([-10, 0, 0]), 5, 0, 1, 3, kind('FIRST'))
  assert.deepEqual([held, drawn.length], [[[5, 0]], 0], 'moved: held')
  // Still: tested where it is, in the open, drawn.
  held.length = 0
  run.vsmRenderCullViews(caster([0, 0, 0]), 5, 0, 1, 3, kind('FIRST'))
  assert.deepEqual([held.length, drawn.length], [0, 1], 'still: drawn')
})

// The second cull, over a record the first held back, and the post cull, over a caster the descent
// found behind a node the first pyramid hid, draw it where this frame's pyramid shows it and leave
// it out where it hides it; neither holds anything back.
test('the second and the post cull draw what this frame’s pyramid shows, and leave out what it hides', () => {
  let hidden = true
  const { run, held, drawn, caster, kind } = viewCull(
    () => true,
    () => hidden,
  )
  for (const name of ['SECOND', 'POST'] as const) {
    drawn.length = 0
    hidden = true
    run.vsmRenderCullViews(caster([0, 0, 0]), 5, 0, 1, 3, kind(name))
    assert.equal(drawn.length, 0, `${name}: hidden, left out`)
    hidden = false
    run.vsmRenderCullViews(caster([0, 0, 0]), 5, 0, 1, 3, kind(name))
    assert.equal(drawn.length, 1, `${name}: shown, drawn`)
  }
  assert.equal(held.length, 0, 'neither holds a record back')
})

// A cluster the software raster takes goes to the bin of its layer, the dynamic layer's or the static
// layer's (the record's bin is its word's tier bits, put by the emit); a hardware one to its tier,
// whatever the layer. The word the cull hands the emit holds no tier.
test('a software cluster is binned by its layer, a hardware one by its tier', () => {
  const C = wgslConstants(CULL)
  for (const [software, flags, bin] of [
    [true, 0, C.VSM_RENDER_SOFTWARE_STATIC_BIN],
    [true, C.VSM_RENDER_CAND_DYNAMIC, C.VSM_RENDER_SOFTWARE_BIN],
    [false, 0, 0],
  ] as const) {
    const { run, drawn, caster, kind } = viewCull(
      () => false,
      () => false,
      software,
    )
    run.vsmRenderCullViews({ ...caster([0, 0, 0]), flags }, 5, 0, 1, 3, kind('FIRST'))
    assert.equal(drawn.length, 1)
    assert.equal(drawn[0]![2], bin, `software ${software}, flags ${flags}`)
    assert.equal(((drawn[0]![1] as number) >>> 24) & 15, 0, 'the word holds no tier')
  }
})

// The previous image's box is projected under the map's previous view once for the map, whatever its
// mips (`vsmPrevBoxInView`), and tested in each; a placement that stood still carries no previous half
// axes: the box it drew has the current ones.
test('the first cull projects the previous box once for all the mips, a still placement’s from its current axes', () => {
  const C = wgslConstants(CULL)
  const { run, held, projections, caster, kind } = viewCull(
    () => true,
    () => false,
    false,
    3,
  )
  const moved = {
    ...caster([-1, 0, 0]),
    ...{ a0: [2, 0, 0], a1: [0, 3, 0], a2: [0, 0, 4], tail1: [0, 0, 0, 7] },
  }
  run.vsmRenderCullViews(moved, 5, 0, 3, 3, kind('FIRST'))
  assert.deepEqual(
    held.map((entry) => entry[1]),
    [0, 1, 2],
    'held in each of the three mip views',
  )
  assert.equal(projections.length, 1, 'projected once')
  assert.deepEqual(
    projections[0]!.slice(2, 5).map((axis) => Array.from(axis as number[])),
    [
      [1, 0, 0],
      [0, 7, 0],
      [0, 0, 1],
    ],
    'the half axes the record holds in its pads',
  )
  projections.length = 0
  const still = { ...moved, flags: C.VSM_RENDER_CAND_STILL, tail1: [0, 0, 0, 0] }
  run.vsmRenderCullViews(still, 5, 0, 1, 3, kind('FIRST'))
  assert.deepEqual(
    projections[0]!.slice(2, 5).map((axis) => Array.from(axis as number[])),
    [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ],
    'a placement that stood still: its current half axes',
  )
})

// A map none of whose views has a page to draw in the caster's layer is left out before its frustum;
// a caster that changed its cache state is not: it redraws the stale pages of both layers, so it goes on
// through the views (the pages themselves filter what it draws).
test('a caster of a layer the map has no stale page in is left out, one that changed its cache state is not', () => {
  const C = wgslConstants(CULL)
  const DYNAMIC_ONLY = 1
  const { run, drawn, boxes, caster, kind } = viewCull(
    () => false,
    () => false,
    false,
    1,
    DYNAMIC_ONLY,
  )
  const cull = (cand: object) => {
    drawn.length = boxes.length = 0
    run.vsmRenderCullViews(cand, 5, 0, 1, DYNAMIC_ONLY, kind('FIRST'))
    return { drawn: drawn.length, frustum: boxes.length }
  }
  const still = caster([0, 0, 0])
  assert.deepEqual(cull(still), { drawn: 0, frustum: 0 }, 'a static caster: out before the frustum')
  assert.deepEqual(
    cull({ ...still, flags: C.VSM_RENDER_CAND_DYNAMIC }),
    { drawn: 1, frustum: 1 },
    'a dynamic one: drawn',
  )
  const turned = { ...still, viewBits: 1 << 16 }
  assert.equal(cull(turned).frustum, 1, 'one whose cache state turned goes on through the views')
})
