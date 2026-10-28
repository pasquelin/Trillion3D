import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { TILE_CLASS, TILE_CLASSES } from '../deferred/tileClass.ts'
import { CLEAR_ENTRY, SAMPLE_ENTRY, clearSamplesWgsl, samplingWgsl } from './samplingWgsl.ts'
import { HASH_ENTRY, hashWgsl } from './hashWgsl.ts'

test('the sampling assembles for every class of tile, with and without rectangle lights', () => {
  for (const tileClass of TILE_CLASSES)
    for (const rect of [false, true]) {
      const code = wgslModule(samplingWgsl(FULL_CONTRACT, tileClass, rect))
      assert.ok(code.includes(`fn ${SAMPLE_ENTRY}(`), `${tileClass} ${rect}`)
      assert.ok(!code.includes('discard'), 'a compute shader discards nothing')
      assert.ok(code.includes('override TILE_MODE'))
    }
})

test('the lobed class reads the lobes and the thin transmission, the simple one neither', () => {
  const simple = wgslModule(samplingWgsl(FULL_CONTRACT, TILE_CLASS.simple, false))
  const complex = wgslModule(samplingWgsl(FULL_CONTRACT, TILE_CLASS.complex, false))
  assert.ok(complex.length > simple.length)
  assert.ok(!simple.includes('thinSubsurface=textureLoad'))
  assert.ok(complex.includes('thinSubsurface=textureLoad'))
})

test('the clearing and the hash entries assemble', () => {
  assert.ok(clearSamplesWgsl().includes(`fn ${CLEAR_ENTRY}(`))
  const hash = hashWgsl()
  assert.ok(hash.includes(`fn ${HASH_ENTRY}(`))
})

test('the WGSL texts this system writes hold no backtick of their own', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  for (const file of readdirSync(new URL('.', import.meta.url)).filter((name) =>
    name.endsWith('Wgsl.ts'),
  )) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.ok(
      !text.includes('\\`'),
      `${file}: an escaped backtick in a template reaches the shader text`,
    )
  }
})
