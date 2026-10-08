// An image none of whose surfaces carries an anisotropic or clear-coat lobe is resolved by a program
// with no lobe code (`../direct/lobesWgsl.ts`), and an image that holds one never is. On a pixel
// without lobes the program with lobe code sums the same, bit for bit: run on the GPU,
// `tests/gpu/lighting/lobes-resolve.gpu.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { recorder } from './recorder.fixture.ts'
import { MIRROR_TERM } from './surfaceWgsl.ts'
import { LOBELESS_LIGHTING_WGSL, LOBELESS_TARGET_WGSL } from '../direct/lobesWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

test('only the program with lobes reads them, lights through them and keeps its mirror term', () => {
  for (const bounce of [false, true]) {
    const plain = contractLightingShader(bounce, { lobeless: true })
    const lobes = contractLightingShader(bounce, {})
    for (const call of ['lobeLight(', 'lobeRectLight(', 'textureLoad(physicalLobes'])
      assert.ok(!plain.includes(call) && lobes.includes(call), call)
    // The lobeless program calls the same names, its stand-ins reading nothing and weighing by one.
    for (const stub of [wgslSource(LOBELESS_LIGHTING_WGSL), wgslSource(LOBELESS_TARGET_WGSL)])
      assert.ok(plain.includes(stub) && !lobes.includes(stub), stub)
    for (const call of ['readLobes(coord,', '*lobeThrough()'])
      assert.ok(plain.includes(call) && lobes.includes(call), call)
    // The term the reflection source output moves keeps its text; the coat adds its own above it.
    assert.ok(lobes.includes(`${MIRROR_TERM};`))
    const coat = 'lobes.coat*surfaceMirrorLighting('
    assert.ok(lobes.includes(coat) && !plain.includes(coat))
  }
})

test('an image with no lobed surface is lit by the lobeless program and compiles no lobe code', async () => {
  const { device } = fakeDevice()
  const lighting = await createDeferredLighting(device)
  const { labels, draw } = recorder(lighting)
  draw({ lobeless: true })
  await lighting.settle()
  // No lobe code compiled beside it: a lobed surface that arrives asks for its program then, and
  // is never lit by the lobeless one.
  draw({ lobeless: true })
  assert.equal(draw({ lobeless: false }), false, 'the lobed program is compiling')
  await lighting.settle()
  draw({ lobeless: false })
  draw({ lobeless: true })
  assert.deepEqual(labels, [
    'DIRECT_LOBELESS_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_LOBELESS_LIGHTING',
  ])
  lighting.dispose()
})
