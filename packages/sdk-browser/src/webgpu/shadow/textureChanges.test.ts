// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The CPU names the rows alone, one scan of the page table a pump, each once to the rows pass's
// list (`ROW_STALES`); the GPU stales each by the sphere the rows pass holds for it: no sphere, no
// box, is made on the CPU.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLAG_BLEND_CASTER, FLAG_MASK, ROW_WORDS } from '../../visibility/types.ts'
import { shadowsFollowSurfaces, shadowsFollowTextures } from '../pages/prepare/lightResources.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { ROW_NAMED, ROW_STALES } from '../../placement/rowWordsWgsl.ts'

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
  const lights = {
    store: { count: 1 },
    casts: casting ? {} : undefined,
    changes: { representationChanged: spy, worldChanged: spy },
  }
  const rt = { lights } as unknown as Pick<WebgpuPagesRuntime, 'lights' | 'rowWords'>
  /** The rows named so far, as the rows pass reads them: each marked staled, `stales` of them. */
  const named = () => {
    const state = rt.rowWords
    if (!state) return []
    const words = [...state.targets.subarray(0, state.count)]
    assert.ok(
      words.every((word) => (word & ROW_STALES) !== 0),
      'each staled',
    )
    assert.equal(state.stales, state.count)
    return words.map((word) => word & ROW_NAMED)
  }
  return { rt, boxes, named }
}

test('a tile of a texture read by a cutout names that cutout, not the opaque surface beside it', () => {
  const { rt, boxes, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), new Set([3]), MAP_LAYER)
  assert.deepEqual(named(), [0])
  assert.equal(boxes.length, 0, 'no box made on the CPU')
})

test('tiles of two textures served by one pump name both cutouts, in one scan', () => {
  const { rt, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), new Set([3, 5]), MAP_LAYER)
  assert.deepEqual(named(), [0, 2])
})

test('a tile of a texture no cutout reads names nothing', () => {
  const { rt, boxes, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), new Set([9]), MAP_LAYER)
  assert.deepEqual(named(), [])
  assert.equal(boxes.length, 0)
})

test('a tile of a texture a blended caster reads names that caster, whose coverage it carries', () => {
  const { rt, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), new Set([7]), MAP_LAYER)
  assert.deepEqual(named(), [3], 'the opaque row on the same texture is left')
})

test('a row that holds no page is never named', () => {
  const { rt, named } = lightsSpy(),
    rows = table()
  rows.packedRecs[0] = undefined as unknown as PageRec
  shadowsFollowTextures(rt, rows, new Set([3, 5]), MAP_LAYER)
  assert.deepEqual(named(), [2])
})

test('without the rows’ shadow changes no sphere holds a row yet: nothing is named', () => {
  const { rt, boxes } = lightsSpy(false)
  shadowsFollowTextures(rt, table(), new Set([3]), MAP_LAYER)
  assert.equal(boxes.length, 0)
})

test('a resize, which names no texture, still restarts everything', () => {
  const { rt, boxes, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), -1, MAP_LAYER)
  assert.equal(boxes.length, 1)
  assert.ok(boxes[0][0] < -1e29 && boxes[0][3] > 1e29)
  assert.deepEqual(named(), [])
})

test('with no light declared, a tile stales nothing and names no row', () => {
  const { rt, boxes, named } = lightsSpy()
  ;(rt.lights.store as { count: number }).count = 0
  shadowsFollowTextures(rt, table(), -1, MAP_LAYER)
  shadowsFollowTextures(rt, table(), new Set([3]), MAP_LAYER)
  assert.equal(boxes.length, 0)
  assert.deepEqual(named(), [])
})

// A page moved a material's alpha: its rows' shadow pages stale whatever their flags say —
// an opaque surface turned masked has no cutout flag until its row is written again.
test('an alpha change names the rows of its surfaces, the opaque and blended ones too', () => {
  const { rt, boxes, named } = lightsSpy()
  shadowsFollowSurfaces(rt, table(), new Set([leaves]))
  assert.deepEqual(named(), [1, 3], 'the still row, then the blended one')
  assert.equal(boxes.length, 0, 'no box made on the CPU')
  shadowsFollowSurfaces(rt, table(), new Set())
  assert.deepEqual(named(), [1, 3], 'no surface, no row')
})

test('a row two pumps name before the rows pass is listed once', () => {
  const { rt, named } = lightsSpy()
  shadowsFollowTextures(rt, table(), new Set([3]), MAP_LAYER)
  shadowsFollowTextures(rt, table(), new Set([3, 5]), MAP_LAYER)
  shadowsFollowSurfaces(rt, table(), new Set([bark]))
  assert.deepEqual(named(), [0, 2], 'the cutout named three times takes one entry')
})
