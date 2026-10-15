import test from 'node:test'
import assert from 'node:assert/strict'
import { packPartitionUniform, type PartitionFrame } from './uniform.ts'
import { PARTITION_UNI_WGSL } from '../core/boxProjectWgsl.ts'
import { PARTITION_UNI } from './contract.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const frame = (
  flags: Pick<PartitionFrame, 'hasRest' | 'viewMoved'>,
  counting = false,
): PartitionFrame => ({
  view: new Float64Array(16),
  viewProj: new Float64Array(16),
  anchor: [0, 0, 0],
  near: 0.1,
  rows: 3,
  width: 8,
  height: 8,
  layerTop: 2,
  counting,
  ...flags,
})

test('the scalar words land where the WGSL uniform names them', () => {
  // One table lays out the struct and the writer: each scalar is read and written by name.
  const declared =
    /rows:u32,width:u32,height:u32,layerTop:u32,hasRest:u32,viewMoved:u32,counting:u32,/
  assert.match(wgslSource(PARTITION_UNI_WGSL), declared)
  const words = new Uint32Array(PARTITION_UNI.words),
    floats = new Float32Array(words.buffer)
  const at = PARTITION_UNI.at,
    scalars = () => [...words.subarray(at.rows, at.counting + 1)]
  packPartitionUniform(words, floats, frame({ hasRest: true, viewMoved: false }), 3)
  assert.deepEqual(scalars(), [3, 8, 8, 2, 1, 0, 0])
  packPartitionUniform(words, floats, frame({ hasRest: false, viewMoved: true }), 3)
  assert.deepEqual(scalars(), [3, 8, 8, 2, 0, 1, 0])
  // The sampled frame (`countsDue`): its kernels count.
  packPartitionUniform(words, floats, frame({ hasRest: false, viewMoved: true }, true), 3)
  assert.deepEqual(scalars(), [3, 8, 8, 2, 0, 1, 1])
})

test('the uniform struct names each member once: a duplicate fails to compile in the browser only', () => {
  // The browser refuses the module, the partition silently gives way to a single pass without
  // occlusion, and Node would never know: the names are checked here.
  const members = [
    ...wgslSource(PARTITION_UNI_WGSL).matchAll(/(\w+):(?=mat4x4f|vec3f|f32|u32|array)/g),
  ].map((match) => match[1])
  assert.ok(members.length >= 12)
  assert.deepEqual(
    members.filter((name, index) => members.indexOf(name) !== index),
    [],
    'no member declared twice',
  )
})
