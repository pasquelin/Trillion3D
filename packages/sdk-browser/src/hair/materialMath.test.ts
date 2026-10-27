// The material of a compacted sample: five words, packed as the material pass packs them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MATERIAL_WGSL } from './materialWgsl.ts'
import {
  HAIR_DEFAULT_MATERIAL,
  HAIR_FLAG,
  packHairSample,
  unpackHairDepth,
  unpackHairSample,
  type HairSample,
} from './materialMath.ts'
import { HAIR_DEPTH_SCALE, HAIR_NODE_DATA_WORDS } from './visibilityMath.ts'

const SAMPLE: HairSample = {
  depth: 0.25,
  tangent: [0, 1, 0],
  coverage8: 200,
  controlPoint: 0x123456,
  macroGroup: 5,
  baseColor: [0.25, 0.04, 0.64],
  roughness: 0.4,
  specular: 0.5,
  backlit: 1,
  flags: HAIR_FLAG.castContactShadow,
  lightChannels: 1,
}

test('a sample is five words, and its fields come back within a step of their byte', () => {
  const words = packHairSample(SAMPLE)
  assert.equal(words.length, HAIR_NODE_DATA_WORDS)
  const back = unpackHairSample(words)
  assert.equal(back.depth, SAMPLE.depth)
  assert.equal(back.controlPoint, SAMPLE.controlPoint)
  assert.equal(back.macroGroup, SAMPLE.macroGroup)
  assert.equal(back.coverage8, SAMPLE.coverage8)
  assert.equal(back.flags, SAMPLE.flags)
  assert.equal(back.lightChannels, 1)
  assert.ok(Math.abs(back.tangent[1] - 1) <= 2 / 255, 'the tangent')
  for (let c = 0; c < 3; c++)
    assert.ok(Math.abs(Math.sqrt(back.baseColor[c]!) - Math.sqrt(SAMPLE.baseColor[c]!)) <= 1 / 255)
  assert.ok(Math.abs(back.roughness - SAMPLE.roughness) <= 1 / 255)
  assert.ok(Math.abs(back.specular - 0.5) <= 1 / 255 && back.backlit === 1)
})

test('the control point takes 28 bits and the macro group the four above, as the words say', () => {
  const words = packHairSample({ ...SAMPLE, controlPoint: 0x0fffffff, macroGroup: 0xf })
  assert.equal(words[1], 0xffffffff)
  assert.equal(
    packHairSample({ ...SAMPLE, controlPoint: 0x1fffffff, macroGroup: 0 })[1],
    0x0fffffff,
  )
})

test('a depth is the steps of a node’s word over the most a depth takes', () => {
  assert.equal(unpackHairDepth((0x00ffffff << 8) >>> 0, HAIR_DEPTH_SCALE), 1)
  assert.equal(unpackHairDepth(0, HAIR_DEPTH_SCALE), 0)
})

test("the material pass writes the words this packing names, the default material's colour and roughness", () => {
  // The shader's packing: the control point's 28 bits, the macro group's four, the byte of a tangent
  // axis, the byte of the default colour's square root and of its roughness, and the flags.
  assert.match(MATERIAL_WGSL, /nodeData\[o\+1u\]=point\|\(\(inst\.flags\.w&15u\)<<28u\);/)
  assert.match(MATERIAL_WGSL, /nodeData\[o\+2u\]=u32\(t\.x\*255\.0\)\|\(u32\(t\.y\*255\.0\)<<8u\)/)
  assert.match(MATERIAL_WGSL, /let rgb=sqrt\(inst\.base\.xyz\);/)
  assert.match(
    MATERIAL_WGSL,
    /unitByte\(rgb\.x\)\|\(unitByte\(rgb\.y\)<<8u\)\|\(unitByte\(rgb\.z\)<<16u\)\|\(unitByte\(inst\.base\.w\)<<24u\)/,
  )
  assert.match(MATERIAL_WGSL, /\(inst\.flags\.x&0xffu\)<<16u/)
  for (const name of ['colors', 'roughness[', 'fn byteOf('])
    assert.ok(!MATERIAL_WGSL.includes(name), `the strands' attributes are not read: ${name}`)
  assert.equal(HAIR_DEFAULT_MATERIAL.color.length, 3)
})
