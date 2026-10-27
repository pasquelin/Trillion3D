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
import { MOBILITY_OFFSET_ALWAYS, MOBILITY_OFFSET_INVALIDATES } from '../../mobilityBits.ts'
import { vsmDescentWgsl } from './traversalWgsl.ts'
import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'
import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const DESCENT = vsmDescentWgsl(LAYOUT)
const CULL = vsmRenderCullWgsl(LAYOUT)
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
// the casters' candidates take it; the radius takes the largest stretch. A node's subtree is needed
// where its error shows at the edge scale of its ball, multiplied out (`vsmRenderErrorShows`).
test('the descent takes the error at the placement’s smallest axis scale and the radius at its largest', () => {
  const asked: unknown[][] = []
  const lens = { focal: 10, near: 0.1, perspective: true }
  const scope = {
    ...C,
    worldsLinear: () => 'linear',
    minAxisScale: () => 0.5,
    framesStretchBits: () => 0x40400000,
    vsmDescentBall: () => [1, 2, 3],
    // The node's view of the running entry (`vsmDescentBegin`): its map's record, its box, its mip's lens.
    descentHeld: { pd: { lightViewToClip: 'projection' }, box: { shiftedToClip: 'clip' }, lens },
    vsmRenderEdgeScales: (...a: unknown[]) => (asked.push(a), [4, 9]),
    vsmRenderErrorShows: (...a: unknown[]) => (asked.push(a), true),
  }
  const { vsmDescentShows } = shaderRun<{ vsmDescentShows(...a: unknown[]): boolean }>(
    DESCENT,
    ['vsmDescentShows'],
    scope,
  )
  const node = { maxParentError: 4, sphere: [0, 0, 0, 2], minimum: [0, 0, 0], maximum: [1, 1, 1] }
  assert.equal(vsmDescentShows(node, 7, 4), true)
  // The ball at the largest stretch (3), seen through the map's clip; the error at the smallest scale
  // (0.5), over the mip's pixels per unit.
  assert.deepEqual(asked[0], [[1, 2, 3], 6, 'clip', 'projection', lens])
  assert.deepEqual(asked[1], [4, 2, 10])
})

test('a node outside its map is not needed, a node no error bounds is, whatever the view', () => {
  const scope = {
    ...C,
    params: { threshold: 2 },
    descentHeld: { pd: { pd: true }, box: { box: true }, lens: {} },
    vsmDescentBoxInMap: () => false,
  }
  const { vsmDescentNeeded, vsmDescentReach, vsmDescentPriority } = shaderRun<{
    vsmDescentNeeded(...a: unknown[]): boolean
    vsmDescentReach(...a: unknown[]): number
    vsmDescentPriority(...a: unknown[]): number
  }>(DESCENT, ['vsmDescentNeeded', 'vsmDescentReach', 'vsmDescentPriority'], scope)
  const node = { maxParentError: 4, sphere: [0, 0, 0, 2], minimum: [0, 0, 0], maximum: [1, 1, 1] }
  assert.equal(vsmDescentNeeded(node, 7), false)
  assert.equal(vsmDescentReach(node, 7), 0)
  assert.equal(vsmDescentNeeded({ ...node, maxParentError: -1 }, 7), true, 'unbounded')
  assert.equal(typeof vsmDescentPriority({ ...node, maxParentError: -1 }, 7), 'number')
})

// The reach of a node, the priority of a leaf it asks (`vsmDescentPriority`): the error over its
// ball's smallest edge scale in pixels, unbounded for a ball wholly behind the near plane.
test('the reach of a node is its error in pixels over the ball’s edge scale, unbounded behind the near plane', () => {
  let scale = 4
  const { vsmDescentReach } = shaderRun<{ vsmDescentReach(...a: unknown[]): number }>(
    DESCENT,
    ['vsmDescentReach'],
    {
      ...C,
      minAxisScale: () => 0.5,
      worldsLinear: () => 'linear',
      descentHeld: {
        pd: {},
        box: { box: true },
        lens: { focal: 10, near: 0.1, perspective: true },
      },
      vsmDescentBoxInMap: () => true,
      vsmDescentScales: () => [scale, 2 * scale],
    },
  )
  const node = { maxParentError: 4, sphere: [0, 0, 0, 2], minimum: [0, 0, 0], maximum: [1, 1, 1] }
  assert.equal(vsmDescentReach(node, 7), (4 * 0.5 * 10) / 4)
  scale = 0
  assert.equal(vsmDescentReach(node, 7), FLOAT32_MAX)
})

// A leaf too coarse is dropped (`viewFloor`) as the reference's cluster cull drops it
// (the reference's cluster culling, `ProjectedEdgeScales.y < LODScale · UniformScale · MinLODError`): its
// floor shows past the threshold at the largest edge scale of its ball, and no cluster of it waits
// for a finer group. Every cluster of such a leaf is then not drawn in that mip by the cull
// (`vsmRenderLodAt`): the clusters' own balls lie in the leaf's, their errors at least its floor.
test('a leaf the descent drops as too coarse has none of its clusters drawn in that mip by the cull', () => {
  const lens = (viewToClip: Mat, mip: number) => ({
    focal: 0.5 * Math.abs(viewToClip[1][1]) * (C.VSM_LEVEL0_TEXELS! >> mip),
    near: viewToClip[3][3] >= 1 ? 0 : viewToClip[3][2] / (1 - viewToClip[2][2]),
    perspective: viewToClip[3][3] < 1,
  })
  const random = mulberry32(5)
  const cull = wgslConstants(CULL)
  const threshold = 2
  const render = shaderRun<{
    vsmRenderEdgeScale(...a: unknown[]): number
    vsmRenderLodAt(...a: unknown[]): number
  }>(CULL, ['vsmRenderEdgeScale', 'vsmRenderLodAt'], { ...cull, params: { threshold } })
  let dropped = 0,
    kept = 0
  for (const viewToClip of [perspective, ortho])
    for (const mip of [0, 3]) {
      const view = lens(viewToClip, mip)
      const centre = { value: [0, 0, 0] }
      const scope = {
        ...C,
        params: { threshold },
        cullOff: () => false,
        pageBaseOf: () => 10,
        childResident: () => resident.value,
        descentHeld: {
          pd: { lightViewToClip: viewToClip },
          box: { shiftedToClip: viewToClip },
          lens: view,
          scaled: false,
        },
        vsmDescentBall: () => centre.value,
        framesStretchBits: () => 0x3f800000,
        minAxisScale: () => 1,
        worldsLinear: () => 'linear',
      }
      const resident = { value: true }
      const { viewFloor } = shaderRun<{ viewFloor(...a: unknown[]): boolean }>(
        DESCENT,
        ['viewFloor'],
        scope,
      )
      for (let k = 0; k < 300; k++) {
        centre.value = [random() * 40 - 20, random() * 40 - 20, -30 - random() * 200]
        const radius = 0.5 + random() * 10,
          minError = random() * 0.5
        const node = {
          ...{ childCount: 0, firstPage: 2, pageCount: 3, minError },
          ...{ sphere: [0, 0, 0, radius], minimum: [0, 0, 0], maximum: [1, 1, 1] },
        }
        resident.value = true
        // A new node: its edge scales are projected afresh (`vsmDescentBegin`).
        scope.descentHeld.scaled = false
        const floor = viewFloor(node, 7)
        // A leaf with a cluster whose finer group is not resident is kept; so is an inner node.
        resident.value = false
        assert.equal(viewFloor(node, 7), false, `${k}: open`)
        assert.equal(viewFloor({ ...node, childCount: 2 }, 7), false, `${k}: inner`)
        assert.equal(viewFloor({ ...node, minError: 0 }, 7), false, `${k}: no floor`)
        if (!floor) {
          kept++
          continue
        }
        dropped++
        // A cluster of the leaf: a ball within the leaf's, an error no smaller than its floor.
        const inner = radius * random()
        const dir = [random() - 0.5, random() - 0.5, random() - 0.5]
        const len = Math.hypot(...dir) || 1
        const offset = (radius - inner) * random()
        const ball = centre.value.map((c, a) => c + (dir[a]! / len) * offset)
        const own = minError * (1 + random() * 3)
        const ownScale = render.vsmRenderEdgeScale(ball, inner, viewToClip, viewToClip, view)
        const cand = {
          ...{ flags: cull.VSM_RENDER_CAND_CHILD_RESIDENT, errors: [own, own * 2] },
          ...{ own: [0, 0, 0, inner], parent: [0, 0, 0, radius] },
        }
        const parentScale = render.vsmRenderEdgeScale(
          centre.value,
          radius,
          viewToClip,
          viewToClip,
          view,
        )
        assert.equal(
          render.vsmRenderLodAt(cand, ownScale, parentScale, view.focal),
          cull.VSM_RENDER_LOD_NOT_DRAWN,
          `${k} mip ${mip}: a cluster of a dropped leaf`,
        )
      }
    }
  assert.ok(dropped > 50 && kept > 50, `${dropped} dropped, ${kept} kept`)
})

// The camera's switch of this cull (`cutMinLodCulling`) is the shadow views' too.
test('a leaf is kept whatever its floor where the host turned the too-coarse cull off', () => {
  const lens = { focal: 0.5 * 0.01 * C.VSM_LEVEL0_TEXELS!, near: 0, perspective: false }
  const scope = (off: boolean) => ({
    ...C,
    cullOff: (bit: number) => off && bit === C.CULL_MIN_LOD_OFF,
    params: { threshold: 1e-9 },
    pageBaseOf: () => 0,
    childResident: () => true,
    descentHeld: { pd: { lightViewToClip: ortho }, box: { shiftedToClip: ortho }, lens },
    vsmDescentBall: () => [0, 0, -50],
    framesStretchBits: () => 0x3f800000,
    minAxisScale: () => 1,
    worldsLinear: () => 'linear',
  })
  const node = {
    ...{ childCount: 0, firstPage: 0, pageCount: 1, minError: 10 },
    ...{ sphere: [0, 0, 0, 1], minimum: [0, 0, 0], maximum: [1, 1, 1] },
  }
  const floor = (off: boolean) =>
    shaderRun<{ viewFloor(...a: unknown[]): boolean }>(
      DESCENT,
      ['viewFloor'],
      scope(off),
    ).viewFloor(node, 7)
  assert.equal(floor(false), true, 'dropped')
  assert.equal(floor(true), false, 'kept with the cull off')
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
      casterSphere: (...a: unknown[]) => sphere.push(a.slice(0, 4)),
      vsmDescentBox: () => ({ box: true }),
    },
  )
  const lo = [0, 0, 0],
    hi = [1, 1, 1]
  assert.deepEqual(vsmDescentBoxOf({ wpoThreshold: 5 }, 7, lo, hi, 0.5), { box: true })
  assert.deepEqual(sphere, [[7, lo, hi, 0.5]], 'grown by the growth it is given')
})
