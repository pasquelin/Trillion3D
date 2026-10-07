// The mip chain of a texture created in the page, built by one compute pass (`texture/mipBatch.ts`),
// against `develop`'s render chain — the reference image of its class-2 bound: every alpha byte and
// every data byte equal, a colour byte within 1 / 255 — the sRGB encode the engine now writes
// itself (`linearToSrgb`) where the render target encoded it. The levels are read after a copy into
// the pool's sRGB format, as tiles are: a level stored `rgba8unorm` copies into it unchanged.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/page-mips.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('the compute chain of a page texture is the render chain within its bound', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'pageMipsPage.ts'),
    'pageMipsPage',
  )) as typeof import('./pageMipsPage.ts')
  const cases = page.chainCases()
  const { adapter, results, errors } = await runOnDawn((all) => page.run(all), cases)
  assert.deepEqual(errors, [])
  const report: string[] = []
  results.forEach(({ engine, reference }, n) => {
    const { name, format } = cases[n]
    assert.equal(engine.length, reference.length, name)
    engine.forEach((bytes, level) => {
      const want = reference[level]
      let colour = 0,
        alpha = 0,
        differing = 0
      for (let i = 0; i < bytes.length; i++) {
        const gap = Math.abs(bytes[i] - want[i])
        if (i % 4 === 3) alpha = Math.max(alpha, gap)
        else colour = Math.max(colour, gap)
        if (gap) differing++
      }
      report.push(`${name} level ${level}: colour ${colour}, alpha ${alpha}, ${differing} bytes`)
      assert.equal(alpha, 0, `${name} level ${level}: an alpha byte moved`)
      assert.ok(colour <= (format === 'rgba8unorm' ? 0 : 1), `${name} level ${level}: ${colour}`)
      assert.ok(level === 0 || want.some(Boolean), `${name} level ${level}: an empty reference`)
    })
    assert.deepEqual(engine[0], cases[n].texels, `${name}: level 0 copied as written`)
  })
  console.log(JSON.stringify({ adapter, report }))
})
