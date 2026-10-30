import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { hairSkyPassWgsl } from './hairLightWgsl.ts'

test('the strands’ sky light is read past the cut the traced sky light makes of the surfaces’ occluded diffuse', () => {
  for (const cubed of [false, true]) {
    const text = wgslModule(hairSkyPassWgsl(cubed) as never)
    assert.match(
      text,
      /environmentLightingWith\(base\.rgb,base\.a,N,1\.0,skyDiffuse\)/,
      `cubed ${cubed}`,
    )
    assert.match(text, /let skyVis=skyLightVisibility\(N,1\.0,N\);/)
    assert.doesNotMatch(text, /lightOut\(environmentLighting\(base/)
  }
})
