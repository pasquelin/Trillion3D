// The blend item record is one field table (`items.ts`): the WGSL struct, its size and the words the
// writer fills are made of it. The struct is the very text the shaders compiled, and each field's
// word is where WGSL's struct rules put it — a vec2 on an even word, a vec4 and the matrix on a
// multiple of four, the record rounded to four words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_ITEM_WGSL, BLEND_ITEM_WORDS } from './items.ts'
import { BLEND_ITEM_SHIPPED } from './itemLayout.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('the item record table yields the shipped struct and its WGSL offsets', () => {
  // Its world, first vertex, flags and deformation, its surface's record by rank — none of its
  // surface's values, which the material table holds once (`../materials/table/materialTable.ts`) —,
  // and the words of its offset a page row carries (`PageInfo.wpo` and the three beside it).
  assert.equal(
    wgslSource(BLEND_ITEM_WGSL),
    'struct BlendItem{world:mat4x4f,vertexBase:u32,flags:u32,deform:u32,material:u32,wpo:u32,wpoDisableSq:f32,wpoMost:f32,wpoCentre:vec3f,opacityClip:f32,}',
  )
  assert.equal(BLEND_ITEM_WORDS, 28)
  // The shipped struct's fields, laid out again by the one table rule the writer's words come from.
  const layout = BLEND_ITEM_SHIPPED
  assert.equal(layout.wgsl, wgslSource(BLEND_ITEM_WGSL))
  assert.equal(layout.words, BLEND_ITEM_WORDS)
  const ITEM = layout.at
  assert.deepEqual(
    [ITEM.world, ITEM.vertexBase, ITEM.flags, ITEM.deform, ITEM.material],
    [0, 16, 17, 18, 19],
  )
  assert.deepEqual(
    [ITEM.wpo, ITEM.wpoDisableSq, ITEM.wpoMost, ITEM.wpoCentre],
    [20, 21, 22, 24],
    'the vec3 on a multiple of four, the record rounded to four words',
  )
  assert.equal(ITEM.opacityClip, 27, 'in the word the vec3 leaves')
})
