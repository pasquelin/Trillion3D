import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { wgslBufferBindings, wgslStageBindings } from '../../gpu/core/wgslBindings.fixture.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { TILE_CLASS, TILE_CLASSES } from '../deferred/tileClass.ts'
import { samplingWgsl } from './samplingWgsl.ts'
import { SHADING_ENTRY, shadingWgsl } from './shadingWgsl.ts'

test('the shading assembles for every class of tile, with and without rectangle lights, and lights each light once with its split term', () => {
  for (const tileClass of TILE_CLASSES)
    for (const rect of [false, true]) {
      const code = wgslModule(shadingWgsl(FULL_CONTRACT, tileClass, rect))
      assert.ok(code.includes(`fn ${SHADING_ENTRY}(`), `${tileClass} ${rect}`)
      assert.ok(code.includes('declaredLightSplit(rank,'))
      assert.ok(!code.includes('discard'), 'a compute shader discards nothing')
      assert.ok(code.includes('textureStore(resolvedDiffuse'))
    }
})

test('the shading and the sampling bind the toon tables where the class holds the models, and ramp the toon diffuse light by light even under a key that writes the toon data', () => {
  const key = { ...FULL_CONTRACT, toonData: true }
  for (const tileClass of TILE_CLASSES) {
    const models = tileClass !== TILE_CLASS.simple
    for (const code of [
      wgslModule(shadingWgsl(key, tileClass, false)),
      wgslModule(samplingWgsl(key, tileClass, false)),
    ]) {
      assert.equal(
        code.includes(
          `@group(0) @binding(${DEFERRED_BINDINGS.toonTables}) var<storage,read> toonTables`,
        ),
        models,
        `class ${tileClass}`,
      )
      assert.ok(!code.includes('toonUnified=('), 'the toon diffuse is not left to a later pass')
      // The storage buffers the entry's code reaches (the declarations it leaves unused are not in its layout).
      const reached = wgslStageBindings(code).find((s) => s.stage === 'compute')!.bindings
      const storage = wgslBufferBindings(code).filter(
        (b) => b.type !== 'uniform' && reached.has(b.binding),
      )
      assert.ok(storage.length <= 8, `${tileClass}: ${storage.length} storage buffers`)
    }
  }
})
