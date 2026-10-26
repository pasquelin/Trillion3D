// The local fog volumes culled by tile (`./fog/localTiling.ts`, `./fog/localCullWgsl.ts`): the view's tiling,
// the tile a pixel and a point lie in, the list each tile keeps — the frustum's cull and the depth pyramid's —
// and that walking a tile's list reads what walking every volume of the view reads
// (`fogLocalRun.fixture.ts`, `fogLocalCull.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { LOCAL_FOG_INSTANCE, LOCAL_FOG_SLOT } from './fog/localLayout.ts'
import { localFogTiling } from './fog/localTiling.ts'
import { FOG_LOCAL_MEDIUM_WGSL, fogTilesWgsl } from './fog/localWgsl.ts'
import { culledLists, wallPyramid } from './fogLocalCull.fixture.ts'
import { EYE, VIEW, localSlots, mediumOf, overOf, placed } from './fogLocalRun.fixture.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

const [WIDTH, HEIGHT] = [VIEW.width, VIEW.height]
const SUN = { light: [3, 2, 1], toward: [0.3, 0.9, 0.3] }
const NO_LIST = 4294967295

/** The block the plan writes for `volumes`, the view tiled by tiles of `size` pixels. */
function tiled(volumes: ReturnType<typeof placed>[], size: number) {
  const tiling = localFogTiling(WIDTH, HEIGHT, size, 32)!
  return { tiling, ...localSlots(volumes, { sun: SUN, tiling }) }
}

/** The ray through the pixel coordinates `(x, y)` of the view (the centre of pixel `(0, 0)` is `(0.5, 0.5)`), at
 *  view depth `depth`. */
const through = (x: number, y: number, depth = 1): V3 => [
  (x / WIDTH) * 2 * VIEW.half[0] * depth - VIEW.half[0] * depth,
  (1 - (y / HEIGHT) * 2) * VIEW.half[1] * depth,
  -depth,
]

/** The device's depth of the point `depth` metres in front of the eye: reversed, the nearer the larger. */
function depthValue(depth: number) {
  const m = VIEW.viewProj
  const p = [EYE[0], EYE[1], EYE[2] - depth, 1]
  const row = (r: number) => p.reduce((sum, c, k) => sum + c * m[4 * k + r], 0)
  return row(2) / row(3)
}

/** Where the plan put the volume whose centre is `at`, among the volumes it wrote: its number in the lists. */
function numberOf(slots: number[][], at: V3) {
  for (let k = 0; ; k++) {
    const centre = slots[LOCAL_FOG_SLOT.instances + k * LOCAL_FOG_INSTANCE.slots]
    if (!centre) throw new Error(`no volume at ${at}`)
    if (at.every((c, i) => Math.abs(c - EYE[i] - centre[i]) < 1e-6)) return k
  }
}

test('the view is cut into tiles of the side the run asks for, whatever the grid holds: the lists are made for the grid, none for a view with no pixel', () => {
  assert.deepEqual(localFogTiling(WIDTH, HEIGHT, 128, 32), {
    size: 128,
    across: 2,
    down: 1,
    stride: 9,
    words: 2 * 9 + 32,
  })
  // The least side at 4K with every volume a view may draw: the side is not raised, the buffer is as large as the grid.
  const fine = localFogTiling(3840, 2160, 8, 256)!
  assert.deepEqual([fine.size, fine.across, fine.down, fine.stride], [8, 480, 270, 65])
  assert.equal(fine.words, 480 * 270 * 65 + 256)
  assert.equal(localFogTiling(0, 90, 128, 32), undefined)
})

test('the tile of a pixel is the one it lies in, the last row and column taking what lies past them; of a point, the one its screen place lies in; a program with no lists, or too few, walks every volume', () => {
  const { slots, tiling } = tiled([placed('a', [0, 2, -12])], 16)
  assert.deepEqual([tiling.across, tiling.down], [10, 6])
  const list = (words: number[], block = slots) =>
    shaderRun<{
      localFogListAt: (pixel: number[]) => number
      localFogListOver: (toward: V3) => number
    }>(
      wgslProgram('', [FOG_LOCAL_MEDIUM_WGSL, fogTilesWgsl({ group: 0, tiles: 1 })]),
      ['localFogListAt', 'localFogListOver'],
      { directLights: { localFog: block }, localFogTiles: words },
    )
  const run = list(new Array(tiling.words).fill(0))
  const start = (x: number, y: number) => (y * 10 + x) * 9
  for (const [pixel, tile] of [
    [
      [0, 0],
      [0, 0],
    ],
    [
      [15.99, 15.99],
      [0, 0],
    ],
    [
      [16, 16],
      [1, 1],
    ],
    [
      [100.5, 50.5],
      [6, 3],
    ],
    [
      [159.5, 89.5],
      [9, 5],
    ],
    [
      [400, 300],
      [9, 5],
    ],
    [
      [-40, 3],
      [0, 0],
    ],
  ] as [number[], number[]][])
    assert.equal(run.localFogListAt(pixel), start(tile[0], tile[1]), `${pixel}`)
  // The point: the tile of the pixel its ray passes through, at any depth.
  for (const [x, y] of [
    [0.5, 0.5],
    [15.5, 15.5],
    [16.5, 16.5],
    [100.5, 50.5],
    [159.5, 89.5],
  ])
    for (const depth of [0.3, 5, 300])
      assert.equal(run.localFogListOver(through(x, y, depth)), run.localFogListAt([x, y]))
  assert.equal(run.localFogListOver([0, 0, 4]), NO_LIST, 'behind the eye: the view’s own list')
  // Not tiled, or lists too small for the tiling (a stand-in): the view's own.
  assert.equal(run.localFogListAt([30, 30]) !== NO_LIST, true)
  assert.equal(list([0]).localFogListAt([30, 30]), NO_LIST, 'a stand-in of one word')
  const untiled = localSlots([placed('a', [0, 2, -12])], { sun: SUN }).slots
  assert.equal(list(new Array(tiling.words).fill(0), untiled).localFogListAt([30, 30]), NO_LIST)
})

test('a volume outside a tile is not in its list: every volume a ray of the tile meets is, on its edges too, and none that lies away from the tile and its neighbours', () => {
  const volumes = [
    placed('ahead', [0, 2, -12]),
    placed('left', [-9, 3, -14], { scale: 0.8 }),
    placed('right', [15, 1, -18], { scale: 1.4 }),
    placed('near', [3, 1.5, -5], { scale: 0.3 }),
    placed('high', [-2, 9, -16], { scale: 0.6 }),
  ]
  const { slots, tiling, count } = tiled(volumes, 16)
  assert.equal(count, volumes.length)
  const { lists } = culledLists(slots, tiling, count)
  const sphere = (k: number) => slots[LOCAL_FOG_SLOT.instances + k * LOCAL_FOG_INSTANCE.slots]
  /** Whether the ray through the pixel coordinates `(x, y)` goes through the volume `k`'s sphere (a hair less
   *  than its radius, so that a ray that grazes it is no ambiguity). */
  const meets = (k: number, x: number, y: number) => {
    const [cx, cy, cz, radius] = sphere(k)
    const d = through(x, y)
    const length = Math.hypot(...d)
    const along = (cx * d[0] + cy * d[1] + cz * d[2]) / length
    const centre = Math.hypot(cx, cy, cz)
    return (
      centre * centre - along * along <= radius * radius * 0.999 && (along > 0 || centre < radius)
    )
  }
  const tileAt = (tx: number, ty: number) => ty * tiling.across + tx
  // Every pixel's centre and every point of the edges of every tile, a half pixel apart.
  let edges = 0
  for (let ty = 0; ty < tiling.down; ty++)
    for (let tx = 0; tx < tiling.across; tx++) {
      const [x0, y0] = [tx * 16, ty * 16]
      const [x1, y1] = [Math.min(x0 + 16, WIDTH), Math.min(y0 + 16, HEIGHT)]
      for (let x = x0; x <= x1; x += 0.5)
        for (let y = y0; y <= y1; y += x === x0 || x === x1 ? 0.5 : y1 - y0) {
          edges++
          for (let k = 0; k < count; k++)
            if (meets(k, x, y)) assert.ok(lists[tileAt(tx, ty)].includes(k), `${k} at ${x},${y}`)
        }
    }
  assert.ok(edges > 2000)
  const meetsNear = (k: number, tx: number, ty: number) => {
    for (let y = Math.max(0, (ty - 1) * 16); y < Math.min(HEIGHT, (ty + 2) * 16); y++)
      for (let x = Math.max(0, (tx - 1) * 16); x < Math.min(WIDTH, (tx + 2) * 16); x++)
        if (meets(k, x + 0.5, y + 0.5)) return true
    return false
  }
  for (let ty = 0; ty < tiling.down; ty++)
    for (let tx = 0; tx < tiling.across; tx++) {
      const list = lists[tileAt(tx, ty)]
      for (const k of list) assert.ok(meetsNear(k, tx, ty), `tile ${tx},${ty} lists ${k}, away`)
      assert.deepEqual(
        list,
        [...list].sort((a, b) => a - b),
        'in the order they are drawn',
      )
    }
  const right = numberOf(slots, [15, 1, -18])
  assert.ok(!lists[0].includes(right), 'the volume on the right is not in the top left tile')
  assert.ok(lists.some((l) => l.includes(right)))
  assert.ok(
    lists.every((l) => l.length < count),
    'no tile keeps them all',
  )
})

test('a volume behind the surfaces the depth pyramid holds is culled where the switch is on, and kept where the surfaces are behind it or the pyramid reaches the sky', () => {
  // The image's left half is a wall 6 metres off. Behind it a volume that lies over the left half only,
  // before it another, and one the wall's edge crosses, over the sky as well, and one over the sky.
  const volumes = [
    placed('behind', [-4, 2, -20], { scale: 0.4 }),
    placed('before', [-4, 2, -4], { scale: 0.4 }),
    placed('edge', [0, 2, -20], { scale: 0.8 }),
    placed('sky', [6, 2, -20], { scale: 0.4 }),
  ]
  assert.ok(depthValue(6) > depthValue(18), 'a nearer surface has the larger depth')
  const { slots, tiling, count } = tiled(volumes, 40)
  const plain = culledLists(slots, tiling, count).lists
  const behind = numberOf(slots, [-4, 2, -20])
  const wall = culledLists(
    slots,
    tiling,
    count,
    wallPyramid(depthValue(6), WIDTH / 2, [WIDTH, HEIGHT]),
  )
  assert.ok(
    plain.some((l) => l.includes(behind)),
    'the frustums alone keep it',
  )
  assert.ok(
    wall.lists.every((l) => !l.includes(behind)),
    'the pyramid culls it, in every tile',
  )
  const kept = (lists: number[][], k: number) => lists.map((l) => l.includes(k))
  for (const at of [
    [-4, 2, -4],
    [0, 2, -20],
    [6, 2, -20],
  ] as V3[])
    assert.deepEqual(
      kept(wall.lists, numberOf(slots, at)),
      kept(plain, numberOf(slots, at)),
      `${at}`,
    )
  // A wall behind the volumes hides nothing of them.
  const far = culledLists(
    slots,
    tiling,
    count,
    wallPyramid(depthValue(30), WIDTH / 2, [WIDTH, HEIGHT]),
  )
  assert.deepEqual(far.lists, plain)
})

/** The pixel a ray `(x · half, y · half, −depth)` of the view's normalised coordinates `(x, y)` passes through. */
const pixelOf = (x: number, y: number) => [(x * 0.5 + 0.5) * WIDTH, (0.5 - y * 0.5) * HEIGHT]

test('walking the list of its tile reads what walking every volume of the view reads: the light of every ray of the view, in its pixel, and of the cells of the volume, the same', () => {
  const volumes = [
    placed('ahead', [0, 2, -12], { albedo: [1, 0.2, 0.2] }),
    placed('left', [-9, 3, -14], { albedo: [0.2, 1, 0.2], scale: 0.8 }),
    placed('right', [15, 1, -18], { albedo: [0.2, 0.2, 1], scale: 1.4 }),
    placed('behind', [1, 2, 14]),
    placed('far side', [-80, 2, -30], { scale: 2 }),
    placed('around', [0.5, 1.5, 0], { scale: 0.3 }),
    placed('over', [2, 2.5, -9], { scale: 0.5, sortPriority: 3 }),
  ]
  const whole = localSlots(volumes, { sun: SUN })
  const [every, everyCell] = [overOf(whole.slots), mediumOf(whole.slots)]
  for (const size of [16, 40, 128, 512]) {
    const { slots, tiling, count } = tiled(volumes, size)
    assert.equal(count, whole.count)
    const { lists, words } = culledLists(slots, tiling, count)
    // A tile as wide as the view is the view's one tile, which holds every volume that shows.
    if (size < WIDTH)
      assert.ok(
        lists.some((l) => l.length < count),
        `tiles of ${size} hold fewer than all`,
      )
    const [keeps, keepsCell] = [overOf(slots, 0, words), mediumOf(slots, words)]
    let compared = 0
    for (const x of [-0.98, -0.5, 0, 0.5, 0.98])
      for (const y of [-0.98, -0.4, 0.3, 0.98])
        for (const depth of [0.3, 2, 8, 15, 40, 300, 1e11]) {
          const ray: V3 = [x * VIEW.half[0] * depth, y * VIEW.half[1] * depth, -depth]
          assert.deepEqual(keeps(ray, pixelOf(x, y)), every(ray), `${size}: ${x},${y} at ${depth}`)
          compared++
          if (depth > 2 && depth < 100)
            assert.deepEqual(
              keepsCell(ray, depth + 1, depth - 1),
              everyCell(ray, depth + 1, depth - 1),
            )
        }
    assert.equal(compared, 140)
  }
})
