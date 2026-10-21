import test from 'node:test'
import assert from 'node:assert/strict'
import { packProjectionUniform, PROJECTION_UNI, type ProjectionFrame } from './projectionUniform.ts'
import { PROJECTION_UNI_WGSL } from './boxProjectWgsl.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const frame: ProjectionFrame = {
  view: new Float64Array(16),
  viewProj: new Float64Array(16),
  anchor: [0, 0, 0],
  near: 0.1,
  width: 8,
  height: 8,
  layerTop: 2,
}

test('the scalar words land where the WGSL uniform names them', () => {
  // One table lays out the struct and the writer: each scalar is read and written by name.
  const declared = /width:u32,height:u32,layerTop:u32,/
  assert.match(wgslSource(PROJECTION_UNI_WGSL), declared)
  const words = new Uint32Array(PROJECTION_UNI.words),
    floats = new Float32Array(words.buffer)
  const at = PROJECTION_UNI.at
  packProjectionUniform(words, floats, frame)
  assert.deepEqual([...words.subarray(at.width, at.layerTop + 1)], [8, 8, 2])
})

test('the uniform struct names each member once: a duplicate fails to compile in the browser only', () => {
  // The browser refuses the module, the transparent occlusion test is then never made, and Node
  // would never know: the names are checked here.
  const members = [
    ...wgslSource(PROJECTION_UNI_WGSL).matchAll(/(\w+):(?=mat4x4f|vec3f|f32|u32|array)/g),
  ].map((match) => match[1])
  assert.ok(members.length >= 8)
  assert.deepEqual(
    members.filter((name, index) => members.indexOf(name) !== index),
    [],
    'no member declared twice',
  )
})
