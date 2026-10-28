// The raster's cut of a segment to the view, on its CPU twin (`rasterClip.fixture.ts`): the spine is cut
// once, before any width, so the two triangles of a ribbon take their corners from the same four (the edge
// they share is then the same numbers in both), and the near plane cuts both long edges where it cuts the
// spine.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hairSpineClip, mixClip } from './rasterClip.fixture.ts'
import { HAIR_RIBBON_CORNERS } from './ribbonCorners.ts'
import { HAIR_INLINE_PIXELS, HAIR_LARGE_LANES } from './rasterLimits.ts'
import { rasterWgsl } from './rasterWgsl.ts'

/** A point at a distance of 1 in front of a camera whose near plane is at 0.1 (the depth reversed: `z`
 *  the near distance, `w` the distance), and one at 0.05, nearer than the near plane. */
const FRONT = [0.2, -0.1, 0.1, 1]
const NEARER = [0.01, -0.02, 0.1, 0.05]

test('a segment that crosses the near plane is cut where it crosses it', () => {
  const [lo, hi] = hairSpineClip(FRONT, NEARER)
  assert.equal(lo, 0, 'the end in front is kept')
  // The plane w − z = 0, from 0.9 in front to −0.05 past it.
  assert.ok(Math.abs(hi - 0.9 / 0.95) < 1e-6, `${hi}`)
  const cut = mixClip(FRONT, NEARER, hi)
  assert.ok(Math.abs(cut[3]! - cut[2]!) <= 2 ** -23, `the cut lies on the near plane: ${cut}`)
})

test('a segment inside is whole, one outside or around a corner of the view holds nothing', () => {
  assert.deepEqual(hairSpineClip(FRONT, [-0.2, 0.1, 0.1, 2]), [0, 1])
  // Behind the camera, both ends.
  const [behindLo, behindHi] = hairSpineClip([0, 0, 0.1, -1], [0.5, 0, 0.1, -2])
  assert.ok(!(behindLo < behindHi))
  // Out past the left plane, then past the top one, never inside both.
  const [aroundLo, aroundHi] = hairSpineClip([-3, 0.5, 0.1, 1], [-0.5, 3, 0.1, 1])
  assert.ok(!(aroundLo < aroundHi), `${aroundLo} ${aroundHi}`)
})

test('the cut lands both corners of the near end on the plane, and the triangles share one edge of the four', () => {
  // The ribbon faces the camera: a control point's two corners share its clip w and z.
  const left0 = [0.1, -0.2, 0.1, 1],
    left1 = [0, 0.01, 0.1, 0.05],
    right0 = [0.15, -0.2, 0.1, 1],
    right1 = [0.02, 0.01, 0.1, 0.05]
  const [lo, hi] = hairSpineClip(FRONT, NEARER)
  // The four corners at the cut, by rank: the tip adds 1, the right side 2 (`cornerRank`).
  const corners = [
    mixClip(left0, left1, lo),
    mixClip(left0, left1, hi),
    mixClip(right0, right1, lo),
    mixClip(right0, right1, hi),
  ]
  for (const r of [1, 3])
    assert.ok(Math.abs(corners[r]![3]! - corners[r]![2]!) <= 2 ** -23, `corner ${r} on the plane`)
  for (const { tips, rights } of Object.values(HAIR_RIBBON_CORNERS)) {
    const rank = (k: number) => ((tips >> k) & 1) + 2 * ((rights >> k) & 1)
    const first = [0, 1, 2].map(rank),
      second = [3, 4, 5].map(rank)
    const shared = first.filter((r) => second.includes(r))
    assert.equal(shared.length, 2, 'the triangles share an edge')
    assert.equal(new Set([...first, ...second]).size, 4, 'and cover the four corners')
  }
})

test('the raster cuts each segment once, before the corners, and builds its triangles from them', () => {
  const code = rasterWgsl(8, true)
  const setup = code.slice(code.indexOf('fn ribbonOf'), code.indexOf('fn ribbonBox'))
  assert.equal(setup.split('hairSpineClip(').length, 2, 'one cut a segment')
  assert.ok(
    setup.indexOf('hairSpineClip(') < setup.indexOf('cornerClip('),
    'the cut before the width',
  )
  const draw = code.slice(code.indexOf('fn drawRibbon'), code.indexOf('@compute'))
  assert.match(
    draw,
    /fillTriangle\(corners\[cornerRank\(k\)\],corners\[cornerRank\(k\+1u\)\],corners\[cornerRank\(k\+2u\)\],ribbon\.code,lane,lanes\)/,
  )
  assert.ok(!code.includes('rasterTriangle'), 'no polygon cut of a triangle')
})

test('a thread draws the ribbons of a tile of pixels at most, a group of threads shares the others', () => {
  const code = rasterWgsl(4, false)
  assert.equal(HAIR_INLINE_PIXELS, 32 * 32, 'the area of a tile of the compute raster')
  const kernel = code.slice(code.indexOf('fn hairRaster('), code.indexOf('fn hairRasterLarge'))
  assert.ok(
    kernel.indexOf('ribbonBox(') < kernel.indexOf('drawRibbon('),
    'a ribbon is measured before one thread draws it',
  )
  assert.match(
    kernel,
    /if\(slot<LARGE_CAPACITY\)\{[^}]*return;/,
    'a listed ribbon is not drawn here',
  )
  assert.ok(
    kernel.includes('\n drawRibbon(ribbon,vec2u(0u),vec2u(1u));'),
    'a ribbon the list has no room for is drawn here, by one thread',
  )
  // The group's threads take every x-th pixel of every y-th row.
  assert.match(code, /for\(var y=rowLo\+lane\.y;y<=rowHi;y\+=lanes\.y\)/)
  assert.match(code, /for\(var x=colLo\+lane\.x;x<=colHi;x\+=lanes\.x\)/)
  const [x, y] = HAIR_LARGE_LANES
  assert.match(code, new RegExp(`@workgroup_size\\(${x},${y}\\) fn hairRasterLarge`))
  assert.match(code, new RegExp(`drawRibbon\\(ribbon,lane\\.xy,vec2u\\(${x}u,${y}u\\)\\)`))
  // The arguments over the list are its count (never past the room), and the list is emptied.
  const args = code.slice(code.indexOf('fn hairLargeArgs'))
  assert.match(args, /largeArgs\[0\]=min\(atomicLoad\(&large\[0\]\),LARGE_CAPACITY\)/)
  assert.match(args, /atomicStore\(&large\[0\],0u\)/)
})
