// A mirror floor reflects the hidden side of an emissive sphere the image does not hold: the world cut
// the sphere at run time, no cooked proxy stands for it, and its own proxy (`runtimeProxyPage.ts`) answers
// where the screen cannot. The floor pixels whose mirror ray meets the sphere (`mirroredSphere`) show its
// emission — a polished metal returns it whole — and none is dark, as the pixels of a black disc below a globe would be.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/runtime-proxy.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

const luma = (pixels: number[], at: number) =>
  0.2126 * pixels[at * 4] + 0.7152 * pixels[at * 4 + 1] + 0.0722 * pixels[at * 4 + 2]

test(
  'the mirror shows the sphere where only its hidden side is in the mirror ray',
  { timeout: 300_000 },
  async () => {
    const page = (await loadPage(
      resolve(import.meta.dirname, 'runtimeProxyPage.ts'),
      'reflectionRuntime',
    )) as typeof import('./runtimeProxyPage.ts')
    const result = await runOnDawn(page.run, undefined)
    assert.equal(result.error, undefined, result.error)
    assert.deepEqual(result.errors, [])
    const { pixels = [], mask = [], frames = 0 } = result
    console.log(JSON.stringify({ frames, mask: mask.length }))
    assert.ok(mask.length > 100, `${mask.length} floor pixels mirror the sphere`)
    const dark = mask.filter((at) => luma(pixels, at) < 60).length
    const bright = mask.filter((at) => luma(pixels, at) >= 150).length
    assert.ok(dark <= 0.02 * mask.length, `${dark} of ${mask.length} mirror pixels are dark`)
    assert.ok(
      bright >= 0.95 * mask.length,
      `${bright} of ${mask.length} mirror pixels show the emission`,
    )
  },
)
