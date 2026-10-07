// A shadow read biases along the receiver's own triangle, not its smooth shading normal. Over
// a coarse terrain the vertex normals lean off each triangle's plane; biased along them, a texel of
// the triangle shades its own neighbours — teeth along every edge as the sun grazes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { declaredLightWgsl } from './lightLoopWgsl.ts'

test('the shading biases along the receiver plane, handed to the read', () => {
  assert.ok(declaredLightWgsl().includes('shadowBiasNormal(select(N,-N,back),shadowReceiverPlane)'))
})
