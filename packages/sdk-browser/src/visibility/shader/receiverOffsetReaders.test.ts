// The resolve writes each pixel's shadow receiver once, packed in 8 bytes (`receiverTargetWgsl.ts`);
// the virtual shadow maps' projection and the deferred lighting read it there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { receiverStoreWgsl, receiverTargetReadWgsl } from './receiverTargetWgsl.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

test('the lighting reads the receiver the resolve wrote: one decode, no triangle decoded again', () => {
  for (const bounce of [false, true])
    for (const narrow of [false, true])
      for (const shadowed of [false, true]) {
        const name = `lighting ${bounce} ${narrow} ${shadowed}`
        const text = contractLightingShader(bounce, {
          narrow,
          unshadowed: !shadowed,
          lobeless: true,
        })
        const first = Number(/@binding\((\d+)\) var receiverTarget:/.exec(text)?.[1])
        assert.equal(
          text.split(receiverTargetReadWgsl(0, first).text).length,
          2,
          `${name}: the target's reader, once`,
        )
        assert.equal(text.match(/\bfn shadowReceiver\(/g)?.length, 1, `${name}: one read`)
        assert.doesNotMatch(text, /var vis:/, `${name}: no visibility buffer re-decoded`)
      }
  // The resolve finds the receiver once and stores it (`receiverTargetWgsl.ts`).
  assert.match(SHADE_SHADER, /=shadowReceiverOfTriangle\(bary,/, 'the resolve finds the receiver')
  assert.equal(
    SHADE_SHADER.match(/\bfn shadowReceiverOfTriangle\(/g)?.length,
    1,
    'by the one function',
  )
  assert.match(
    SHADE_SHADER,
    /storeReceiver\(pos\.xy,rcvOffset,rcvPlane\)/,
    'and stores it (`storageOnce.test.ts`)',
  )
  assert.equal('shadingOffset' in SHADE_BINDINGS, false, 'the resolve binds no offset target')
})

test('the receiver target keeps the offset to 1/4095 of its largest component and the plane to 4.2e-3 rad; a zero plane is no receiver', () => {
  // One texel: what the resolve's `storeReceiver` writes, the projection's `shadowReceiver` reads.
  let texel = [0, 0, 0, 0]
  const scope = {
    receiverOutput: {},
    receiverTarget: {},
    textureDimensions: () => [8, 8],
    textureStore: (_target: object, _at: number[], value: number[]) => void (texel = value),
    textureLoad: () => texel,
  }
  const { storeReceiver } = shaderRun<{
    storeReceiver: (pos: number[], offset: number[], plane: number[]) => void
  }>(
    wgslModule(receiverStoreWgsl(0)),
    ['storeReceiver', 'octEncode', 'octFold', 'ndcToUvUnflipped', 'pow2FromExponent'],
    scope,
  )
  const { shadowReceiver } = shaderRun<{
    shadowReceiver: (pixel: number[]) => { offset: number[]; plane: number[] }
  }>(
    wgslModule(receiverTargetReadWgsl(0, 0)),
    [
      'shadowReceiver',
      'shadowReceiverTexel',
      'shadowReceiverOf',
      'octDecode',
      'octUnfold',
      'octFold',
      'unitToSigned2',
      'pow2FromExponent',
    ],
    scope,
  )
  const r = lcgRandom(1570)
  for (let i = 0; i < 5000; i++) {
    // Offsets over the shared exponent's range, 2^-26 to 2^4 m; planes of any length and side.
    const scale = 2 ** (r() * 30 - 26),
      offset = [0, 1, 2].map(() => (r() * 2 - 1) * scale),
      plane = [0, 1, 2].map(() => (r() * 2 - 1) * 10 ** (r() * 4 - 2))
    storeReceiver([3.5, 2.5], offset, plane)
    const read = shadowReceiver([3.5, 2.5]),
      largest = Math.max(...offset.map(Math.abs)),
      error = Math.max(...offset.map((x, k) => Math.abs(read.offset[k] - x)))
    // Below the smallest exponent the step is 2^-26 / 4095 m: half of it at most.
    if (largest >= 2 ** -26) assert.ok(error <= largest / 4095, `offset ${offset}`)
    else assert.ok(error <= 2 ** -26 / 8190, `offset ${offset}`)
    const length = Math.hypot(...plane),
      cosine = plane.reduce((sum, x, k) => sum + (x / length) * read.plane[k], 0)
    assert.ok(Math.acos(Math.min(1, cosine)) <= 4.2e-3, `plane ${plane}`)
  }
  // A zero plane is no receiver; a zero offset is one, on its plane.
  storeReceiver([1.5, 1.5], [0.1, 0, 0], [0, 0, 0])
  assert.deepEqual(texel, [0, 0, 0, 0])
  assert.deepEqual(shadowReceiver([1.5, 1.5]), { offset: [0, 0, 0], plane: [0, 0, 0] })
  storeReceiver([1.5, 1.5], [0, 0, 0], [0, 3, 0])
  const flat = shadowReceiver([1.5, 1.5])
  assert.deepEqual(flat.offset, [0, 0, 0])
  assert.ok(flat.plane[1] > 0.999, `plane ${flat.plane}`)
  // Past the target's size, nothing is written.
  const kept = texel
  storeReceiver([8.5, 1.5], [1, 1, 1], [1, 0, 0])
  assert.equal(texel, kept)
})
