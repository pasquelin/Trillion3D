// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The CPU names the rows alone, one scan of the page table a pump; the GPU stales each by the
// sphere the rows pass holds for it (`namedCasts.ts`): no sphere, no box, is made on the CPU.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLAG_BLEND_CASTER, FLAG_MASK, ROW_WORDS } from '../../visibility/types.ts'
import { shadowsFollowSurfaces, shadowsFollowTextures } from '../pages/prepare/lightResources.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'

/** Three colour textures, at slots 3, 5 and 7 of the atlas; the surfaces that wear them. */
const [T3, T5, T7] = [{}, {}, {}] as unknown as Texture[]
const MAP_LAYER = new Map([
  [T3, 3],
  [T5, 5],
  [T7, 7],
])
const leaves = { map: T7 } as unknown as PageSurface,
  bark = { map: T3 } as unknown as PageSurface,
  knots = { map: T5 } as unknown as PageSurface

const record = (material: PageSurface) => ({ material }) as unknown as PageRec

/** Three visibility rows — a masked cutout on texture 3, an opaque surface on texture 7, a cutout
 *  on texture 5 —, then a blended caster's row on texture 7, each its surface's colour map. */
function table() {
  const ints = new Uint32Array(4 * ROW_WORDS)
  ints[0 * ROW_WORDS + PAGE_INFO.at.flags] = FLAG_MASK
  ints[1 * ROW_WORDS + PAGE_INFO.at.flags] = 0
  ints[2 * ROW_WORDS + PAGE_INFO.at.flags] = FLAG_MASK
  ints[3 * ROW_WORDS + PAGE_INFO.at.flags] = FLAG_BLEND_CASTER
  return {
    rowCount: 3,
    blendFirst: 3,
    casterSlots: 4,
    pageTableInts: ints,
    packedRecs: [record(bark), record(leaves), record(knots), record(leaves)],
  }
}

/** A light casting, its rows' shadow changes made (`castChanges.ts`), and a spy of the CPU's boxes. */
function lightsSpy(casting = true) {
  const boxes: number[][] = []
  const spy = (min: number[], max: number[]) => void boxes.push([...min, ...max])
  const casts = { named: { rows: new Uint32Array(2), count: 0 } }
  const lights = {
    store: { count: 1 },
    casts: casting ? casts : undefined,
    changes: { representationChanged: spy, worldChanged: spy },
  } as unknown as Parameters<typeof shadowsFollowTextures>[0]
  /** The rows named so far, as the kernel reads them: the count at word 0. */
  const named = () => {
    assert.equal(casts.named.rows[0], casts.named.count, 'the count the kernel reads')
    return [...casts.named.rows.subarray(1, casts.named.count + 1)]
  }
  return { lights, boxes, named }
}

test('a tile of a texture read by a cutout names that cutout, not the opaque surface beside it', () => {
  const { lights, boxes, named } = lightsSpy()
  shadowsFollowTextures(lights, table(), new Set([3]), MAP_LAYER)
  assert.deepEqual(named(), [0])
  assert.equal(boxes.length, 0, 'no box made on the CPU')
})

test('tiles of two textures served by one pump name both cutouts, in one scan', () => {
  const { lights, named } = lightsSpy()
  shadowsFollowTextures(lights, table(), new Set([3, 5]), MAP_LAYER)
  assert.deepEqual(named(), [0, 2])
})

test('a tile of a texture no cutout reads names nothing', () => {
  const { lights, boxes, named } = lightsSpy()
  shadowsFollowTextures(lights, table(), new Set([9]), MAP_LAYER)
  assert.deepEqual(named(), [])
  assert.equal(boxes.length, 0)
})

test('a tile of a texture a blended caster reads names that caster, whose coverage it carries', () => {
  const { lights, named } = lightsSpy()
  shadowsFollowTextures(lights, table(), new Set([7]), MAP_LAYER)
  assert.deepEqual(named(), [3], 'the opaque row on the same texture is left')
})

test('a row that holds no page is never named', () => {
  const { lights, named } = lightsSpy(),
    rows = table()
  rows.packedRecs[0] = undefined as unknown as PageRec
  shadowsFollowTextures(lights, rows, new Set([3, 5]), MAP_LAYER)
  assert.deepEqual(named(), [2])
})

test('without the rows’ shadow changes no sphere holds a row yet: nothing is named', () => {
  const { lights, boxes } = lightsSpy(false)
  shadowsFollowTextures(lights, table(), new Set([3]), MAP_LAYER)
  assert.equal(boxes.length, 0)
})

test('a resize, which names no texture, still restarts everything', () => {
  const { lights, boxes, named } = lightsSpy()
  shadowsFollowTextures(lights, table(), -1, MAP_LAYER)
  assert.equal(boxes.length, 1)
  assert.ok(boxes[0][0] < -1e29 && boxes[0][3] > 1e29)
  assert.deepEqual(named(), [])
})

test('with no light declared, a tile stales nothing and names no row', () => {
  const { lights, boxes, named } = lightsSpy()
  ;(lights.store as { count: number }).count = 0
  shadowsFollowTextures(lights, table(), -1, MAP_LAYER)
  shadowsFollowTextures(lights, table(), new Set([3]), MAP_LAYER)
  assert.equal(boxes.length, 0)
  assert.deepEqual(named(), [])
})

// A page moved a material's alpha: its rows' shadow pages stale whatever their flags say —
// an opaque surface turned masked has no cutout flag until its row is written again.
test('an alpha change names the rows of its surfaces, the opaque and blended ones too', () => {
  const { lights, boxes, named } = lightsSpy()
  shadowsFollowSurfaces(lights, table(), new Set([leaves]))
  assert.deepEqual(named(), [1, 3], 'the still row, then the blended one')
  assert.equal(boxes.length, 0, 'no box made on the CPU')
  shadowsFollowSurfaces(lights, table(), new Set())
  assert.deepEqual(named(), [1, 3], 'no surface, no row')
})
