// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The textures a pump changed are declared together: one scan of the page table, one box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ceilFloat32 } from '../../../../math/src/float/splitDouble.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { FLAG_BLEND_CASTER, FLAG_MASK, PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { ROW_FLAGS_WORD, ROW_MAP_LAYER_WORD } from '../row/pageRow.ts'
import { shadowsFollowSurfaces, shadowsFollowTextures } from '../pages/prepare/lightResources.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { PageRec } from '../../page/selection/types.ts'

const WORDS = PAGE_INFO_STRIDE / 4

const leaves = {} as PageSurface,
  bark = {} as PageSurface

/** The roots the records rank, one each, at `x` on the axis; those in `movingRoots` already move. */
const roots: { world: G.Matrix4 }[] = [],
  movingRoots = new Set<number>()

/** One record of root rank `roots.length - 1` (the record carries no placement). */
function record(x: number, material = bark, moving = false) {
  if (moving) movingRoots.add(roots.length)
  roots.push({ world: new G.Matrix4().makeTranslation(x, 0, 0) })
  return {
    material,
    min: [-1, -1, -1],
    max: [1, 1, 1],
  } as unknown as PageRec
}

/** Three visibility rows — a masked cutout on texture 3, an opaque surface on texture 3, a cutout
 *  on texture 5 —, then a blended caster's row on texture 7. Each row draws packed rank
 *  `row`, and `rootOfPacked` names the root that rank belongs to. */
function table() {
  const ints = new Uint32Array(4 * WORDS),
    base = roots.length
  ints[0 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK
  ints[0 * WORDS + ROW_MAP_LAYER_WORD] = 3
  ints[1 * WORDS + ROW_FLAGS_WORD] = 0
  ints[1 * WORDS + ROW_MAP_LAYER_WORD] = 3
  ints[2 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK
  ints[2 * WORDS + ROW_MAP_LAYER_WORD] = 5
  ints[3 * WORDS + ROW_FLAGS_WORD] = FLAG_BLEND_CASTER
  ints[3 * WORDS + ROW_MAP_LAYER_WORD] = 7
  const packedRecs = [record(0), record(100, leaves), record(10), record(-20, leaves)]
  return {
    rowCount: 3,
    blendFirst: 3,
    casterSlots: 4,
    pageTableInts: ints,
    packedRecs,
    packedPageIndex: Int32Array.from([0, 1, 2, 3]),
    rootOfPacked: Int32Array.from([base, base + 1, base + 2, base + 3]),
  }
}

/** A spy of the plan; the roots of `movingRoots` alone already move. `moving` says, box by box, whether the
 *  change was declared on moving casters alone. */
function lightsSpy() {
  const boxes: number[][] = [],
    worlds: number[][] = [],
    moving: boolean[] = []
  const spy =
    (into: number[][]) =>
    (min: number[], max: number[], movingOnly = false) => {
      into.push([...min, ...max])
      moving.push(movingOnly)
    }
  const lights = {
    store: { count: 1 },
    mobility: { moves: (placement: number) => movingRoots.has(placement) },
    changes: { representationChanged: spy(boxes), worldChanged: spy(worlds) },
  } as unknown as Parameters<typeof shadowsFollowTextures>[0]
  return { lights, boxes, worlds, moving }
}

/** A unit cube's sphere radius as the engine packs it: rounded up to f32, never down. */
const r = ceilFloat32(Math.sqrt(3))

test('a tile of a texture read by a cutout stales the box of that cutout, not the opaque surface beside it', () => {
  const { lights, boxes } = lightsSpy(),
    rows = table()
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, new Set([3]))
  assert.equal(boxes.length, 1)
  // Row 0 alone: its sphere has radius √3 around the origin, in single precision as the GPU
  // reads it. Row 1, opaque at x = 100, is left out.
  assert.deepEqual(boxes[0], [-r, -r, -r, r, r, r])
})

test('tiles of two textures served by one pump declare one box, the union of their cutouts', () => {
  const { lights, boxes } = lightsSpy(),
    rows = table()
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, new Set([3, 5]))
  assert.equal(boxes.length, 1, 'one scan, one change')
  assert.deepEqual(boxes[0], [-r, -r, -r, 10 + r, r, r])
})

test('a tile of a texture no cutout reads stales nothing', () => {
  const { lights, boxes } = lightsSpy(),
    rows = table()
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, new Set([9]))
  assert.equal(boxes.length, 0)
})

test('a tile of a texture a blended caster reads stales that caster, whose coverage it carries', () => {
  const { lights, boxes, moving } = lightsSpy(),
    rows = table()
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, new Set([7]))
  assert.deepEqual(boxes, [[-20 - r, -r, -r, -20 + r, r, r]])
  assert.deepEqual(moving, [true], 'the static layer never holds a blended caster')
})

// The static layer holds no row of a moving placement; its change leaves that layer as it is.
test("a tile read by a moving cutout and a still one declares two boxes: the moving one's apart", () => {
  const { lights, boxes, moving } = lightsSpy(),
    rows = table()
  rows.packedRecs[2] = record(10, bark, true)
  rows.rootOfPacked[2] = roots.length - 1
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, new Set([3, 5]))
  assert.deepEqual(boxes, [
    [-r, -r, -r, r, r, r],
    [10 - r, -r, -r, 10 + r, r, r],
  ])
  assert.deepEqual(moving, [false, true])
})

test('a resize, which names no texture, still restarts everything', () => {
  const { lights, boxes } = lightsSpy(),
    rows = table()
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, -1)
  assert.equal(boxes.length, 1)
  assert.ok(boxes[0][0] < -1e29 && boxes[0][3] > 1e29)
})

test('with no light declared, a tile stales nothing and leaves no change waiting', () => {
  const { lights, boxes } = lightsSpy()
  const rows = table()
  ;(lights.store as { count: number }).count = 0
  shadowsFollowTextures(lights, rows, roots, rows.rootOfPacked, -1)
  assert.equal(boxes.length, 0)
})

// A page moved a material's alpha: its rows' shadow pages stale whatever their flags say —
// an opaque surface turned masked has no cutout flag until its row is written again.
test('an alpha change stales the rows of its surfaces at once, the opaque and blended ones too', () => {
  const { lights, boxes, worlds } = lightsSpy(),
    rows = table()
  shadowsFollowSurfaces(lights, rows, roots, rows.rootOfPacked, new Set([leaves]))
  assert.deepEqual(
    worlds,
    [
      [100 - r, -r, -r, 100 + r, r, r],
      [-20 - r, -r, -r, -20 + r, r, r],
    ],
    'another world, not held: the still row, then the blended one as moving casters',
  )
  assert.equal(boxes.length, 0, 'nothing waits for the camera to rest')
  shadowsFollowSurfaces(lights, rows, roots, rows.rootOfPacked, new Set())
  assert.equal(worlds.length, 2, 'no surface, no box')
})
