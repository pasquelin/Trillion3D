// The trace's per-light rules, read from the shipped WGSL: a hair pixel's receiver plane faces the
// light, and only a local light of no width drops its steps (a sun's rays march theirs, its disk
// of no width or not; a single tap takes none).
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { vsmSunsProjectionWgsl } from '../projection/projectionWgsl.ts'
import { vsmLayout } from '../layout.ts'

const CODE = vsmSunsProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }))
const trace = functionsOf(CODE, ['vsmTraceLight'])

test("a hair pixel's receiver plane faces the light: the slope reads the axis, not the normal", () => {
  assert.match(trace, /let n=select\(pixel\.info\.worldNormal,axis,pixel\.info\.hair\);/)
  assert.match(trace, /intoFrame\(basis,n\)/)
  assert.match(trace, /vsmDepthGradientUv\(pd,pInMap,n\)/)
  assert.doesNotMatch(trace, /pixel\.info\.worldNormal[^,]/)
})

test('the surface info of an opaque pixel carries the hair model of its flags', () => {
  const surface = functionsOf(CODE, ['vsmSurfaceOf'])
  assert.match(surface, /r\.hair=pixelModelOf\(flag\)==\d+u;/)
})

test("only a local light's point source drops its steps; a sun's disk of no width keeps them", () => {
  assert.match(trace, /if\(single\|\|\(s==0\.0&&!directional\)\)\{stepCount=0;\}/)
  assert.doesNotMatch(trace, /if\(s==0\.0\)\{stepCount=0;\}/)
})
