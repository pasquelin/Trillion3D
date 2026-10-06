import test from 'node:test'
import assert from 'node:assert/strict'
import { withScreenReflections } from './screenWgsl.ts'
import { withReflectionSourceOutput } from './sourceOutputWgsl.ts'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { DIRECT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

// #1342: develop's source had no camera fog and no mirror term; the reprojected HDR target had both.
test('the lighting writes the source before camera fog and the mirror term, the lit image intact', () => {
  const shader = withReflectionSourceOutput(withScreenReflections(DIRECT_LIGHTING_SHADER, true))
  const body = functionText(shader, 'litSurface')
  const held = 'reflectionSourceRgb=rgb;reflectionSourceHeld=true;'
  // Every fogged colour is held first, the lit one before its mirror term is added.
  assert.equal(body.split(held).length - 1, body.split('rgb=fogged(').length - 1)
  assert.match(body, /reflectionSourceHeld=true;rgb\+=mirrorLighting\([^;]*\);if\(/)
  assert.doesNotMatch(body, /\+mirrorLighting\([^;]*\);reflectionSourceRgb/)
  const entry = functionText(shader, 'lightSurface')
  assert.match(entry, /->LitSurface\{/)
  assert.match(entry, /select\(color,vec4f\(reflectionSourceRgb,1\.0\),reflectionSourceHeld\)/)
  assert.match(shader, /@location\(0\) lit:vec4f,@location\(1\) source:vec4f/)
})

test('a lighting text the output cannot find refuses, never a silent source', () => {
  assert.throws(() => withReflectionSourceOutput('fn other(){}'), /UNMATCHED/)
  // A mirror term the lighting no longer adds right before its fog: refused, never held.
  const lit = withScreenReflections(DIRECT_LIGHTING_SHADER, true)
  const moved = lit.replace(
    '+mirrorLighting(base.rgb,base.a,normal.a,N,V,P);',
    '+mirrorLighting(base.rgb,base.a,normal.a,N,V,P);rgb=rgb;',
  )
  assert.notEqual(moved, lit)
  assert.throws(() => withReflectionSourceOutput(moved), /UNMATCHED/)
})
