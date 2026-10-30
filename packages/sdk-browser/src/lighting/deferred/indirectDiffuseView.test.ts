// The view of the indirect diffuse light alone (`indirect-diffuse`): the indirect pass alone draws it, a grey of 0.18 stands for the diffuse
// colour of every surface (a metal's too) in the terms that light it, and the surface's own colours stay for the rest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { drawsLit, lightViewCode } from '../../visibility/shader/shadeMode.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { INDIRECT_DIFFUSE_VIEW_WGSL } from '../direct/indirectDiffuseView.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import { litSteps } from './litProgram.ts'
import { TILE_CLASS } from './tileClass.ts'

/** The diffuse colour of the indirect light in the view; the surface's colour is spent by the metal, as the lobeless program has it. */
function colourOf(rgb: number[], metal: number) {
  const run = shaderRun<{ indirectDiffuseColour: (rgb: number[], metal: number) => number[] }>(
    INDIRECT_DIFFUSE_VIEW_WGSL.text,
    ['indirectDiffuseColour'],
    { clothDiffuse: (c: number[], m: number) => [...c, m] },
  )
  return run.indirectDiffuseColour(rgb, metal)
}

test('the view lights the surfaces with its own step of the indirect pass, as a lit view of the beauty chain', () => {
  assert.equal(lightViewCode('indirect-diffuse'), 5)
  assert.equal(drawsLit('indirect-diffuse'), true)
  assert.deepEqual(litSteps(5, 3), ['indirectDiffuse'])
  assert.deepEqual(litSteps(1, 3), ['indirect'])
})

test('the diffuse colour is a grey of 0.18 on any surface, a metal’s too', () => {
  assert.deepEqual(colourOf([0.9, 0.5, 0.1], 1), [0.18, 0.18, 0.18, 0])
  assert.deepEqual(colourOf([0.2, 0.2, 0.2], 0), [0.18, 0.18, 0.18, 0])
})

test('the view exists in its own variant of the indirect pass, with and without the probes, and in no other', () => {
  for (const bounce of [false, true]) {
    const base = { bounce, skyShadowing: false, tileClass: TILE_CLASS.simple }
    const plain = wgslModule(indirectPassWgsl(base))
    assert.doesNotMatch(plain, /indirectDiffuse/, 'the default text holds nothing of the view')
    assert.doesNotMatch(plain, /vec3f\(0\.18\)/)
    const text = wgslModule(indirectPassWgsl({ ...base, diffuseView: true }))
    assert.match(text, /environmentLighting\(vec3f\(0\.18\),0\.0,/)
    assert.match(text, /volumetricLightmapLighting\(coord,vec3f\(0\.18\),0\.0,/)
    assert.doesNotMatch(text, /indirect\[1\]/, 'no reflection is added')
    assert.equal(/fn indirectDiffuseColour\(/.test(text), bounce)
    if (bounce) {
      assert.match(text, /let colour=indirectDiffuseColour\(rgb,metal\);/)
      const body = text.slice(
        text.indexOf('fn resolvedIndirect('),
        text.indexOf('\n}', text.indexOf('fn resolvedIndirect(')),
      )
      assert.doesNotMatch(
        body,
        /resolvedReflectionTexel|resolvedWeighed/,
        'the traced reflection is not read',
      )
      assert.match(body, /return mat2x3f\(diffuse,vec3f\(0\.0\)\);/)
    }
  }
})
