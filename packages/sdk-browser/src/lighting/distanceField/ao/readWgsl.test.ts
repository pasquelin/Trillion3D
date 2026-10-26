// What the lit pass reads of the sky light's distance-field occlusion, on the shipped text (`shaderRun`): the uniform
// that describes the image (`writeDfaoRead`), the image packed into a buffer by the occlusion's last pass (`dfaoPack`), and
// the bent normal a pixel finds in it (`dfaoBentNormal`) — weighed by depth at an edge, held to the view, faded with distance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { fromHalf, toHalf } from '../../../../../math/src/float/half.ts'
import { resolveDistanceFieldOcclusion } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { DFAO_PACK_WGSL } from './packWgsl.ts'
import { DFAO_READ_WORDS, dfaoReadWgsl, writeDfaoRead } from './readWgsl.ts'

const settings = resolveDistanceFieldOcclusion(resolveSettings(DISTANCE_FIELD_OCCLUSION_RULES, {}))
type Vec3 = [number, number, number]
type Cell = [Vec3, number]

/** The read uniform for a scene buffer of `extent` pixels drawn over `view` of them, as the lit pass sees it. */
function uniformFor(extent: [number, number], view: [number, number], perspective = true) {
  const words = writeDfaoRead(
    new Float32Array(DFAO_READ_WORDS),
    { extent, view, near: 0.1, far: 100, perspective },
    settings,
  )
  const part = (at: number) => Array.from(words.slice(at, at + 4))
  return { extent: part(0), limits: part(4), depth: part(8) }
}

/** The image packed as `dfaoPack` leaves it: two words a cell, the bent normal and the depth in four half floats. */
const packed = (cells: Cell[]) =>
  cells.map(([[x, y, z], depth]) => [
    (toHalf(x) | (toHalf(y) << 16)) >>> 0,
    (toHalf(z) | (toHalf(depth) << 16)) >>> 0,
  ])

/** `dfaoBentNormal` and `dfaoApplyBentNormal` over `cells` (row by row, `width` a row) read with `read`. */
function reader(cells: Cell[], read: ReturnType<typeof uniformFor>) {
  return shaderRun<{
    dfaoBentNormal: (pixel: number[], z: number) => { bent: Vec3; fade: number }
    dfaoApplyBentNormal: (u: { bent: Vec3; fade: number }, normal: Vec3) => Vec3
  }>(dfaoReadWgsl(0, 1, 2), ['dfaoBentNormal', 'dfaoApplyBentNormal'], {
    dfaoBent: packed(cells),
    dfaoRead: read,
  })
}

/** The device depth of a point `metres` from the eye under the perspective of `uniformFor`. */
const deviceDepth = (metres: number) => 0.1 / metres
const near = (a: number, b: number, why: string, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) < eps, `${why}: ${a} against ${b}`)

test('the read uniform holds the buffer’s size, the grid’s, the farthest place a read takes, the fade and the depth’s terms', () => {
  const view = uniformFor([1000, 600], [960, 540])
  assert.deepEqual(view.extent, [1000, 600, 500, 300])
  near(view.limits[0], (480 - 0.51) / 500, 'x', 1e-6)
  near(view.limits[1], (270 - 0.51) / 300, 'y', 1e-6)
  assert.equal(view.limits[2], settings.maxViewDistance)
  near(
    view.limits[3],
    1 / ((1 - settings.viewFadeDistanceScale) * settings.maxViewDistance),
    'fade',
    1e-9,
  )
  assert.deepEqual(
    view.depth,
    [Math.fround(0.1), 0, 1, 0],
    'a perspective: the near plane over the depth',
  )
  assert.deepEqual(uniformFor([8, 8], [8, 8], false).depth, [
    Math.fround(99.9),
    Math.fround(0.1),
    0,
    0,
  ])
})

test('the occlusion packs a cell as two words of half floats, row by row, inside the view alone', () => {
  const cells: Cell[][] = Array.from({ length: 6 }, (_, y) =>
    Array.from({ length: 8 }, (_, x): Cell => [[x / 8, y / 8, 0.5], 100 + x + 10 * y]),
  )
  const out: number[][] = []
  const { dfaoPack } = shaderRun<{ dfaoPack: (id: number[]) => void }>(
    DFAO_PACK_WGSL,
    ['dfaoPack'],
    {
      dfao: { grid: [8, 6, 12, 8] },
      image: { load: ([x, y]: number[]) => [...cells[y][x][0], cells[y][x][1]] },
      packed: out,
    },
  )
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) dfaoPack([x, y, 0])
  assert.equal(
    out.filter(Boolean).length,
    6 * 4,
    'a view of 12 × 8 pixels is 6 × 4 cells of the grid',
  )
  const at = (x: number, y: number) => out[y * 8 + x]
  const word = at(3, 2)
  const [bx, by] = [fromHalf(word[0] & 0xffff), fromHalf(word[0] >>> 16)]
  const [bz, depth] = [fromHalf(word[1] & 0xffff), fromHalf(word[1] >>> 16)]
  assert.deepEqual([bx, by, bz, depth], [3 / 8, 2 / 8, 0.5, 123])
  assert.equal(at(6, 0), undefined, 'past the view')
})

test('a pixel finds the bent normal of the surface it is on, by the depth of the cells round it', () => {
  // Two surfaces side by side in a grid of 8 × 6 cells: the left half 5 m away, bent straight up; the right half 20 m away, to the side.
  const cells = Array.from({ length: 48 }, (_, i): Cell =>
    i % 8 < 4 ? [[0, 0, 1], 500] : [[1, 0, 0], 2000],
  )
  const run = reader(cells, uniformFor([16, 12], [16, 12]))
  const front = run.dfaoBentNormal([8, 6], deviceDepth(5)).bent
  const back = run.dfaoBentNormal([8, 6], deviceDepth(20)).bent
  near(front[2], 1, 'the near surface keeps its own bent normal')
  near(back[0], 1, 'the far one its own')
  const apart = run.dfaoBentNormal([8, 6], deviceDepth(12.5)).bent
  assert.ok(apart[0] > 0 && apart[2] > 0, 'a depth between the two takes some of both')
})

test('the place read is held to the view: no cell past it, however far the pixel is', () => {
  // The view is the left 8 pixels of a buffer 16 wide: the cells past the fourth hold another image, which no read of it reaches.
  const cells = Array.from({ length: 48 }, (_, i): Cell =>
    i % 8 < 4 ? [[0, 0, 1], 500] : [[1, 0, 0], 500],
  )
  const run = reader(cells, uniformFor([16, 12], [8, 12]))
  const read = run.dfaoBentNormal([15.5, 6.5], deviceDepth(5)).bent
  near(read[2], 1, 'the last cell of the view', 1e-3)
  near(read[0], 0, 'none of the cells past it', 1e-3)
})

test('the bent normal fades to the surface’s own normal with distance, whole near and gone past the farthest pixel lit', () => {
  const cells = Array.from({ length: 48 }, (): Cell => [[0, 0.5, 0.5], 500])
  const run = reader(cells, uniformFor([16, 12], [16, 12]))
  const N: Vec3 = [0, 0, 1]
  const nearRead = run.dfaoBentNormal([8, 6], deviceDepth(5))
  assert.equal(nearRead.fade, 1)
  assert.deepEqual(run.dfaoApplyBentNormal(nearRead, N), [0, 0.5, 0.5])
  const far = run.dfaoBentNormal([8, 6], deviceDepth(250))
  assert.equal(far.fade, 0)
  assert.deepEqual(run.dfaoApplyBentNormal(far, N), N)
  // Between: 20000 cm is the farthest lit, the fade starts at 70 % of it.
  const between = run.dfaoBentNormal([8, 6], deviceDepth(190))
  assert.ok(between.fade > 0 && between.fade < 1)
})
