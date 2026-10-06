// A transparent mirror reflects the resident proxy (`blendMirrorPage.ts`): the shipped blend
// fragment over a square, a one-triangle proxy in front of it. The reflected triangle lands where an
// orthographic mirror puts it — the same x and y —, follows the proxy when it moves, stays black
// without the mirror term, and is never gained by a rough, diffuse or toon surface, nor with bounce
// off.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/blend-mirror.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

/** Pixels whose red channel holds light: f16 words, four per pixel. */
const lit = (pixels: number[]) => pixels.filter((value, i) => i % 4 === 0 && value > 0).length

test('the transparent mirror reflects the proxy where a mirror would, and nothing else', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'blendMirrorPage.ts'),
    'blendMirrorPage',
  )) as typeof import('./blendMirrorPage.ts')
  const result = await runOnDawn(() => page.run(), null)
  assert.deepEqual(result.compilation, [])
  assert.deepEqual(result.errors, [])
  for (const [withTerm, withoutTerm] of result.families)
    assert.deepEqual(withTerm, withoutTerm, 'a diffuse or toon surface gains no reflection')
  assert.deepEqual(result.mirror, result.repeat, 'a still reflection is the same image')
  assert.deepEqual(result.off, result.offPrevious, 'bounce off, the mirror term adds nothing')
  assert.deepEqual(result.rough, result.roughPrevious, 'a rough surface gains no mirror')
  assert.equal(lit(result.previous), 0, 'without the mirror term, the square is black')
  assert.ok(lit(result.mirror) > 100, 'the triangle is clearly reflected')
  assert.ok(lit(result.mirror) < 700, 'the reflected triangle does not fill the mirror')
  const opaque = result.mirror.filter((value, i) => i % 4 === 3 && value === 0x3c00).length
  assert.equal(opaque, result.width * result.width, 'every pixel of the mirror draws')
  // The oracle, independent of the engine: an orthographic mirror returns the triangle at the
  // same x and y, its legs on the left and bottom edges of its bounds.
  for (const [image, left, bottom, right, top] of [
    [result.mirror, -0.7, -0.6, 0.6, 0.71],
    [result.second, -0.45, -0.2, 0.4, 0.5],
  ] as const)
    for (let y = 0; y < result.width; y++)
      for (let x = 0; x < result.width; x++) {
        const px = -1 + ((x + 0.5) * 2) / result.width,
          py = 1 - ((y + 0.5) * 2) / result.width
        const inside =
          px >= left &&
          py >= bottom &&
          (px - left) / (right - left) + (py - bottom) / (top - bottom) <= 1
        assert.equal(image[(y * result.width + x) * 4] > 0, inside, `reflection at ${x},${y}`)
      }
})
