// The trace's per-light rules, read from the shipped WGSL: a hair pixel's receiver plane faces the
// light, and only a local light of no width drops its steps (a sun's rays march theirs, its disk
// of no width or not; a single tap takes none), and a ray's point on the light's disk: a sun's by the
// exact map, a local light's by the approximate equal-area one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { VSM_TRACE_COMMON_WGSL } from './traceCommonWgsl.ts'
import { approxDiskMap } from '../../../../../../math/src/wgsl/sampling.ts'
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

test("a sun's ray takes the exact square-to-disk map, a local light's the approximate one", () => {
  assert.match(trace, /vsmConeDirection\(basis,s,vsmLightDisk\(directional,noise4\.xy\)\)/)
  assert.match(
    functionsOf(VSM_TRACE_COMMON_WGSL, ['vsmLightDisk']),
    /fn vsmLightDisk\(directional:bool,E:vec2f\)->vec2f\{\s*if\(directional\)\{return vsmSquareToDisk\(E\);\}\s*return approxDiskMap\(E\);/,
  )
  const { approxDiskMap: disk } = shaderRun<{
    approxDiskMap: (e: number[]) => number[]
  }>(approxDiskMap, ['approxDiskMap'], {})
  const near = (got: number[], want: number[], label: string) =>
    want.forEach((v, k) => {
      assert.ok(Math.abs(got[k]! - v) < 1e-6, `${label}: ${got} is not ${want}`)
    })
  // The square's centre, the middle of a side, a corner: the point on the disk the map sends it to.
  near(disk([0.5, 0.5]), [0, 0], 'centre')
  near(disk([1, 0.5]), [1, 0], 'middle of a side')
  near(disk([0.5, 0]), [0, -1], 'middle of the bottom')
  near(disk([0, 0]), [-Math.SQRT1_2, -Math.SQRT1_2], 'corner')
  // Any point of the square lands inside the unit disk, in the square point's quadrant.
  for (let i = 0; i <= 16; i++)
    for (let j = 0; j <= 16; j++) {
      const [x, y] = disk([i / 16, j / 16])
      assert.ok(x * x + y * y <= 1 + 1e-6, `(${i}, ${j}) leaves the disk`)
      const side = Math.sign(i - 8)
      assert.ok(Math.sign(x) === side || Math.abs(x) < 1e-6, `x of (${i}, ${j})`)
    }
})
