// The blend item record is one field table (`items.ts`): the WGSL struct, its size and the words the
// writer fills are made of it. The struct is the very text the shaders compiled, and each field's
// word is where WGSL's struct rules put it — a vec2 on an even word, a vec4 and the matrix on a
// multiple of four, the record rounded to four words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_ITEM_WGSL, BLEND_ITEM_WORDS } from './items.ts'
import { fieldLayout } from './fieldLayout.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

test('the item record table yields the shipped struct and its WGSL offsets', () => {
  assert.equal(
    wgslSource(BLEND_ITEM_WGSL),
    'struct BlendItem{world:mat4x4f,color:vec4f,indexCount:u32,vertexBase:u32,flags:u32,mapIndex:u32,emissiveIndex:u32,lineWidth:f32,alphaTest:f32,aoIntensity:f32,roughness:f32,metalness:f32,normalScale:vec2f,roughIndex:u32,metalIndex:u32,normalIndex:u32,aoIndex:u32,emissive:vec4f,dash:vec2f,sprite:vec2f,subsurface:vec4f,deform:u32,deformInput:u32,deformOutput:u32,physical:u32,}',
  )
  assert.equal(BLEND_ITEM_WORDS, 52)
  // The shipped struct's fields, laid out again by the one table rule the writer's words come from.
  const fields = Array.from(
    wgslSource(BLEND_ITEM_WGSL).matchAll(/(\w+):(\w+),/g),
    ([, name, type]) => [name, type] as [string, Parameters<typeof fieldLayout>[1][number][1]],
  )
  const layout = fieldLayout('BlendItem', fields)
  assert.equal(layout.wgsl, wgslSource(BLEND_ITEM_WGSL))
  assert.equal(layout.words, BLEND_ITEM_WORDS)
  const ITEM = layout.at
  assert.deepEqual(
    [ITEM.world, ITEM.color, ITEM.indexCount, ITEM.flags, ITEM.lineWidth, ITEM.roughness],
    [0, 16, 20, 22, 25, 28],
  )
  assert.deepEqual(
    [ITEM.normalScale, ITEM.roughIndex, ITEM.aoIndex, ITEM.emissive, ITEM.dash, ITEM.sprite],
    [30, 32, 35, 36, 40, 42],
  )
  assert.deepEqual(
    [ITEM.subsurface, ITEM.deform, ITEM.deformInput, ITEM.deformOutput, ITEM.physical],
    [44, 48, 49, 50, 51],
  )
})
