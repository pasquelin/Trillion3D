// The shadow views' descent judges the level of detail as the camera's cut does (`traversalWgsl.ts`):
// the error of a placement is taken at its smallest axis scale, and the bounds of a placement are
// grown by the reach of its offsets only in the maps that allow them (`vsmDescentGrowth`). Each
// rule is the cull's own (`../render/renderCullWgsl.ts`), so no node the descent drops holds a
// cluster the cull would draw.

import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { MOBILITY_OFFSET_ALWAYS, MOBILITY_OFFSET_INVALIDATES } from '../../mobilityBits.ts'
import { vsmDescentWgsl } from './traversalWgsl.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const DESCENT = vsmDescentWgsl(LAYOUT)
const C = wgslConstants(DESCENT)

const perspective = new Mat([1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
const ortho = new Mat([0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1])

// A map's lens: the pixels a unit spans at depth one at the mip, its near plane and whether it is a
// perspective view; an orthographic view has no near plane.
test('a map’s lens reads its projection at the mip, a sun’s with no near plane', () => {
  const { vsmViewLens } = shaderRun<{
    vsmViewLens(...a: unknown[]): Record<string, number | boolean>
  }>(DESCENT, ['vsmViewLens'], C)
  const texels = (mip: number) => C.VSM_LEVEL0_TEXELS! >> mip
  const close = (a: unknown, b: number) => Math.abs((a as number) - b) <= 1e-6 * Math.max(1, b)
  const lens = vsmViewLens(perspective, 2)
  assert.ok(close(lens.focal, 0.5 * 1.2 * texels(2)) && close(lens.near, 0.1))
  assert.equal(lens.perspective, true, 'a perspective map')
  const flat = vsmViewLens(ortho, 0)
  assert.ok(close(flat.focal, 0.5 * 0.01 * texels(0)) && flat.near === 0)
  assert.equal(flat.perspective, false, 'an orthographic map')
})

// The error a placement scales is its smallest axis scale, as the camera's cut (`placedScale`) and
// the casters' candidates take it; the radius takes the largest stretch.
test('the descent takes the error at the placement’s smallest axis scale and the radius at its largest', () => {
  const asked: unknown[][] = []
  const { vsmDescentSeen, vsmDescentReach } = shaderRun<{
    vsmDescentSeen(...a: unknown[]): number
    vsmDescentReach(...a: unknown[]): number
  }>(DESCENT, ['vsmDescentSeen', 'vsmDescentReach'], {
    ...C,
    worldsLinear: () => 'linear',
    minAxisScale: () => 0.5,
    framesStretchBits: () => 0x40400000,
    descentMip: () => 2,
    vsmDescentBall: () => [1, 2, 3],
    vsmDescentPixels: (...a: unknown[]) => (asked.push(a), 9),
    descentMap: () => 3,
    vsmHandleFromId: (id: number) => ({ id }),
    vsmProjectionOf: () => ({ pd: true }),
    vsmDescentBoxOf: () => ({ shiftedToClip: 'clip' }),
    vsmDescentBoxInMap: () => true,
  })
  const node = { maxParentError: 4, sphere: [0, 0, 0, 2], minimum: [0, 0, 0], maximum: [1, 1, 1] }
  assert.equal(vsmDescentSeen({ pd: true }, { shiftedToClip: 'clip' }, node, 7, 4), 9)
  assert.deepEqual(asked.at(-1), [{ pd: true }, 'clip', 2, [1, 2, 3], 6, 2])
  assert.equal(vsmDescentReach(node, 7), 9, 'a kept leaf is prioritised by the ceiling')
  assert.deepEqual(asked.at(-1), [{ pd: true }, 'clip', 2, [1, 2, 3], 6, 2])
})

test('a node outside its map spans no pixels of its subtree’s error, a node no error bounds builds no box', () => {
  let boxes = 0
  const scope = {
    ...C,
    params: { threshold: 2 },
    descentMap: () => 3,
    vsmHandleFromId: (id: number) => ({ id }),
    vsmProjectionOf: () => ({ pd: true }),
    vsmDescentBoxOf: () => (boxes++, { box: true }),
    vsmDescentBoxInMap: () => false,
  }
  const { vsmDescentReach, vsmDescentPriority } = shaderRun<{
    vsmDescentReach(...a: unknown[]): number
    vsmDescentPriority(...a: unknown[]): number
  }>(DESCENT, ['vsmDescentReach', 'vsmDescentPriority'], scope)
  const node = { maxParentError: 4, sphere: [0, 0, 0, 2], minimum: [0, 0, 0], maximum: [1, 1, 1] }
  assert.equal(vsmDescentReach(node, 7), 0)
  assert.equal(boxes, 1)
  vsmDescentPriority({ ...node, maxParentError: -1 }, 7)
  assert.equal(boxes, 1, 'an unbounded node: no box')
})

// Where the offsets' reach grows a placement's bounds: the maps that allow its offset — it may
// invalidate its shadows, and it is evaluated whatever the distance says, or the map's level is not
// past the distance its object stops at — grow them by the mark's whole reach; the others by the
// deformation's alone, which the placement's section of the buffer carries (`vsmBareReach`).
test('a map grows the bounds of a placement by its offsets’ reach only where it allows them', () => {
  /** The placement's words, and the mark's whole reach of 0.75, 0.25 of it the deformation's. */
  const growth = (word: number, disableSq: number, threshold: number, deform = 0.25) => {
    const { vsmDescentGrowth } = shaderRun<{ vsmDescentGrowth(...a: unknown[]): number }>(
      DESCENT,
      ['vsmDescentGrowth'],
      {
        ...C,
        deformReach: 0.75,
        vsmRootWords: () => ({ word, viewBits: 0, disableSq, deformReach: deform }),
      },
    )
    return vsmDescentGrowth(7, threshold)
  }
  const word = MOBILITY_OFFSET_INVALIDATES
  assert.equal(growth(word, 0, 99), 0.75, 'an object that stops at no distance')
  assert.equal(growth(word, 4, 1), 0.75, 'a level within the distance')
  assert.equal(growth(word, 4, 4), 0.75, 'a level at the distance')
  assert.equal(growth(word, 4, 9), 0.25, 'a level past the distance: the deformation’s alone')
  assert.equal(growth(word | MOBILITY_OFFSET_ALWAYS, 4, 9), 0.75, 'evaluated whatever the distance')
  assert.equal(growth(0, 0, 0), 0.25, 'an offset that may not invalidate: no map grows it')
  assert.equal(growth(0, 0, 0, 0), 0, 'a placement with neither')
  assert.equal(growth(word, 4, 9, 1), 0.75, 'a reach never beyond the mark’s')
})

// The box of a node is grown by the reach the map allows, and carries its sphere (`boxSight` reads it).
test('the box of a node is grown by the map’s growth and carries its sphere', () => {
  const sphere: unknown[][] = []
  const { vsmDescentBoxOf } = shaderRun<{ vsmDescentBoxOf(...a: unknown[]): unknown }>(
    DESCENT,
    ['vsmDescentBoxOf'],
    {
      ...C,
      vsmDescentGrowth: (_w: number, threshold: number) => threshold / 10,
      casterSphere: (...a: unknown[]) => sphere.push(a.slice(0, 4)),
      vsmDescentBox: () => ({ box: true }),
    },
  )
  const lo = [0, 0, 0],
    hi = [1, 1, 1]
  assert.deepEqual(vsmDescentBoxOf({ wpoThreshold: 5 }, 7, lo, hi), { box: true })
  assert.deepEqual(sphere, [[7, lo, hi, 0.5]], 'grown by the growth of the map’s threshold')
})
