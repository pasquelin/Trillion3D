// The trace's per-light rules, read from the shipped WGSL: a hair pixel's receiver plane faces the
// light, and only a local light of no width drops its steps (a sun's rays march theirs, its disk
// of no width or not; a single tap takes none), and a ray's point on the light's disk: a sun's by the
// exact map, a local light's by the approximate equal-area one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { VSM_TRACE_COMMON_WGSL, rayCountStatement } from './traceCommonWgsl.ts'
import { approxDiskMap, uniformDiskConcentric } from '../../../../../../math/src/wgsl/sampling.ts'
import { vsmSunsProjectionWgsl } from '../projection/projectionWgsl.ts'
import { vsmLayout } from '../layout.ts'
import { vsmSampleLightWgsl } from '../sampleLightWgsl.ts'
import { forwardPool } from '../../../direct/shadowBindings.ts'
import { wgslSource } from '../../../../../../math/src/wgsl/source.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'

const CODE = vsmSunsProjectionWgsl(
  vsmLayout({
    coverMode: 'suns',
    fullMapCapacity: 127,
    sunMapCapacity: 35,
  }),
)
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
    /fn vsmLightDisk\(directional:bool,E:vec2f\)->vec2f\{\s*if\(directional\)\{return uniformDiskConcentric\(E\);\}\s*return approxDiskMap\(E\);/,
  )
  const { approxDiskMap: disk } = shaderRun<{
    approxDiskMap: (e: number[]) => number[]
  }>(approxDiskMap, ['approxDiskMap'], {})
  const near = (got: number[], want: number[], label: string) =>
    want.forEach((v, k) => {
      assert.ok(Math.abs(got[k]! - v) < 1e-6, `${label}: ${got} is not ${want}`)
    })
  // The exact map takes the same points to the same places on the circle: the middle of a side, a corner.
  const { uniformDiskConcentric: exact } = shaderRun<{
    uniformDiskConcentric: (e: number[]) => number[]
  }>(uniformDiskConcentric, ['uniformDiskConcentric'], {})
  near(exact([0.5, 0.5]), [0, 0], 'exact centre')
  near(exact([1, 0.5]), [1, 0], 'exact middle of a side')
  near(exact([0, 0]), [-Math.SQRT1_2, -Math.SQRT1_2], 'exact corner')
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

test("a ray's cosine is its cone's own: finite where the sine reaches 1, and the direction's z", () => {
  const { vsmConeDirection } = shaderRun<{
    vsmConeDirection: (
      basis: object,
      s: number,
      disk: number[],
    ) => { dir: number[]; cosTheta: number }
  }>(VSM_TRACE_COMMON_WGSL, ['vsmConeDirection'], {})
  const basis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
  const inside = vsmConeDirection(basis, 1, [0.6, 0])
  assert.ok(Math.abs(inside.cosTheta - 0.8) < 1e-6)
  assert.equal(inside.dir[2], inside.cosTheta)
  // The disk's rim one ulp-scale past the unit sine: the cosine is 0, not NaN.
  const rim = vsmConeDirection(basis, 1, [1 + 2 ** -20, 0])
  assert.equal(rim.cosTheta, 0)
  assert.ok(rim.dir.every(Number.isFinite))
})

test("a fragment's local light stops its rays by the subgroup's vote, and traces them all without subgroups", () => {
  // The statement in a loop of the trace's shape: a lane whose ray 0 misses (`hit` false).
  const traced = (subgroups: boolean) =>
    shaderRun<{ tracedRays: (rayCap: number) => number }>(
      `fn tracedRays(rayCap:u32)->u32{
 let directional=false;
 var missed=0u;
 var stopped=false;
 var stopIndex=0u;
 var count=0u;
 for(var i=0u;i<rayCap;i++){
  let running=!stopped;
  var hit=false;
  if(running){
   count+=1u;
   missed|=1u<<i;
  }
${rayCountStatement(true, subgroups)} }
 return count;
}`,
      ['tracedRays'],
      { vsm: { adaptiveRayCount: 2 }, subgroupAllTrue: (c: boolean) => c },
    ).tracedRays(8)
  assert.equal(traced(true), 1)
  assert.equal(traced(false), 8)
  assert.equal(rayCountStatement(true, false), '')
})

test("a local map with a receiver cover starts its rays at the receiver footprint's mip, never finer than its own", () => {
  assert.match(
    trace,
    /if\(!directional&&pd\.useCover\)\{\s*lightMap\.mip=vsmLocalMipAt\(pd,pInMap,pixel\.sceneDepth,vsmView\.viewToClip,vsmView\.viewPixels\.xy,0\.0\);\s*\}/,
  )
})

// The local mip rule, run: a pixel's footprint in the map (an identity view and map, a unit at depth
// one a thousandth of a view of 1000 pixels: 32.768 texels of the level-0 grid, log2 = 5.04), the
// map's resolution bias, the pool's pressure bias and the extra bias added before the floor, held to
// the mode's mips (all, the even ones, the odd ones) and to the map's finest.
test('the local mip of a pixel: footprint, biases, mode and finest', () => {
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const mipAt = (
    over: { levelBias?: number; finestMip?: number },
    vsm: { pressureBias: number; mipModeLocal: number },
    extraBias: number,
  ) =>
    shaderRun<{ vsmLocalMipAt: (...args: unknown[]) => number }>(CODE, ['vsmLocalMipAt'], {
      vsm,
    }).vsmLocalMipAt(
      { shiftedToMapUv: identity, lightViewToClip: identity, levelBias: 0, finestMip: 0, ...over },
      [0, 0, 0],
      0,
      identity,
      [1000, 1000],
      extraBias,
    )
  const all = { pressureBias: 0, mipModeLocal: 0 }
  assert.equal(mipAt({}, all, 0), 5)
  assert.equal(mipAt({}, all, 1), 6, 'the extra bias is added before the floor')
  assert.equal(mipAt({ levelBias: 1 }, all, 0), 6, 'the map bias')
  assert.equal(mipAt({}, { ...all, pressureBias: 1 }, 0), 6, 'the pool pressure bias')
  assert.equal(mipAt({}, { ...all, mipModeLocal: 1 }, 1), 6, 'the even mips: 6 stays')
  assert.equal(mipAt({}, { ...all, mipModeLocal: 1 }, 0), 4, 'the even mips: 5 drops to 4')
  assert.equal(mipAt({}, { ...all, mipModeLocal: 2 }, 0), 5, 'the odd mips: 5 stays')
  assert.equal(mipAt({}, { ...all, mipModeLocal: 2 }, 1), 7, 'the odd mips: 6 rises to 7')
  assert.equal(mipAt({ finestMip: 6 }, all, 0), 6, 'never finer than the map')
})

test("the depth of field bias is on a pixel's read of a sun's level, off a translucent one-sample read", () => {
  assert.match(trace, /vsmLightMapAt\(light,P,pixel\.sceneDepth\)/)
  assert.match(functionsOf(CODE, ['vsmLightMapAt']), /vsmSampledLevel\(base,d2,sceneDepth\)/)
  const sample = functionsOf(wgslSource(vsmSampleLightWgsl(forwardPool(0))), ['vsmSampleLight'])
  assert.match(sample, /vsmLightMapAt\(light,shifted,-1\.0\)/)
})
