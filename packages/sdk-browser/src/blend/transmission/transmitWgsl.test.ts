import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { transmitWgsl } from './transmitWgsl.ts'

const text = wgslModule(transmitWgsl({}, true))

test('the thin layer covers by what the material does not transmit, its metal and its roughness, at a coverage of one', () => {
  assert.match(
    text,
    /var top=\(1\.0-cut\)\*max\(1\.0-t,max\(metal,clamp\(s\.rough,0\.0,1\.0\)\)\);/,
  )
  assert.match(text, /var coverage=1\.0;/)
})

test('the distortion bends by the index of refraction less one, at every incidence', () => {
  assert.match(text, /let raw=viewNormal\*\(ior-1\.0\);/)
  const offset = text.slice(text.indexOf('fn distortionOffset'), text.indexOf('fn distortedScene'))
  assert.ok(!/fresnel/i.test(offset))
})

test('a masked material is clear where its base map reaches a third of alpha, and has no specular there', () => {
  assert.match(text, /let masked=\(m\.model&\d+u\)!=0u;/)
  assert.match(text, /let cut=select\(0\.0,1\.0,masked&&k\.mapAlpha>=0\.333\);/)
  assert.match(text, /var tint=mix\(s\.rgb\*t,vec3f\(1\.0\),cut\);/)
  assert.match(text, /if\(masked\)\{surfaceSpecular=1\.0-cut;\}/)
})

test('a thin layer marks the responsiveness by an opacity of one, in the pass of its own', () => {
  assert.match(
    text,
    /fn fsTransmitResponsive\(in:VSOut,@builtin\(front_facing\) front:bool\)->Marked/,
  )
  assert.match(
    text,
    /var opacity=1\.0;\s*if\(\(in\.ids\.y&\d+u\)!=0u\)\{opacity=blendDiagnosticOut\(in,layer\.s,deltas\)\.color\.a;\}/,
  )
  assert.ok(!/blendResponsive\(in,[ac]\)/.test(text))
})
