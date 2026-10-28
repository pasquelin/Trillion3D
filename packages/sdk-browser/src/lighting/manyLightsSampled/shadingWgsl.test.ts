import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { TILE_CLASSES } from '../deferred/tileClass.ts'
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
