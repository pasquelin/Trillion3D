import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spatialMipCounts, textureKinds } from './spatialCounts.ts'

const ranks = new Uint32Array(64 * 36)
const [plain, cut, glass] = [{}, {}, {}]
const counts = (served: number, texture?: object, kindOf?: ReturnType<typeof textureKinds>) => {
  const color = {
    pages: { entries: 1, tileOf: () => ({ slot: 1, level: 0, tx: 0, ty: 0 }) },
    servedLevel: () => served,
    textures: [{}, { texture }],
  }
  const atlases = { color, data: { ...color, pages: { ...color.pages, entries: 0 } } }
  return spatialMipCounts(ranks, 64, 36, atlases as never, kindOf)
}

test('spatial feedback maps sampled r32uint ranks to requested and served mips', () => {
  ranks.fill(1)
  const atLevel = counts(0)
  assert.ok(atLevel.center.requested >= 64 && atLevel.periphery.requested >= 64)
  assert.equal(atLevel.center.atLevel, atLevel.center.requested)
  assert.equal(counts(1).center.mips['0->1'], atLevel.center.requested)
  ranks.fill(2)
  assert.throws(() => counts(0), /RANK_INVALID/)
})

test('spatial feedback splits each region into opaque, mask and blend surface textures', () => {
  const surface = (map: object, alphaTest = 0) => ({ map, alphaTest })
  const allPages = [{ material: surface(glass), transparent: true }, { material: surface(plain) }]
  allPages.push({ material: surface(cut, 0.5) }, { material: surface(plain, 0.5) })
  const kindOf = textureKinds({ setup: { allPages, blendCopies: [] } } as never)
  const kinds = [plain, cut, glass, undefined].map((texture) => kindOf(texture as never))
  assert.deepEqual(kinds, ['mask', 'mask', 'blend', 'opaque'])
  ranks.fill(1)
  const split = counts(0, glass, kindOf)
  assert.equal(split.center.kinds.blend.atLevel, split.center.requested)
  assert.equal(split.periphery.kinds.opaque.requested, 0)
})
