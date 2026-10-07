// The blended and water read's bias, transmission and modes (`vsmFilteredRead.test.ts`): each texel's
// own receiver-plane bias, the receiver's own transmission, mode 0 as it stood, no state kept between lights.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { functionText } from '../../bounce/wgslBody.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { type V, MAP, World, SOURCE, run } from './vsmFilteredRead.fixture.ts'
import {
  FILTER,
  type Filter,
  pagedSample,
  REQUESTED,
  developCoverage,
  pagedWorld,
  SUN_READ,
  sunWorld,
} from './vsmFilteredSample.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

test('each texel takes its own receiver-plane bias: a tilted receiver never shadows itself', () => {
  const p = [700.37, 900.81],
    slope = [0.004, -0.0025, 1e9, 1]
  // The pool holds the receiver's own plane at every texel centre.
  const plane = (t: V) => 0.5 + slope[0] * (t[0] + 0.5 - p[0]) + slope[1] * (t[1] + 0.5 - p[1])
  const world = pagedWorld(plane)
  const f = run<Filter>(world, FILTER)
  const sm = pagedSample(p)
  assert.equal(f.vsmFilterTaps(REQUESTED, sm, 0.5, slope, true), 1)
  // One bias for the whole footprint — the sample texel's — shadows the plane's rising side.
  const centre = sm.mapTexelXY.map((t, a) => t + 0.5 - p[a])
  const one = Math.min(2 * Math.max(0, slope[0] * centre[0] + slope[1] * centre[1]), slope[2])
  assert.ok(developCoverage(p, (t) => plane(t) - one <= 0.5) < 1, 'a single bias would')
})

test('the transmission is the receiver’s own, read once wherever a texel lets the opaque light through', () => {
  const sun = { directionCone: [0, -1, 0, 0], shape: [0.005, 0, 0, 0], params: [2, 0, 0, 0] }
  const colour = [0x99, 0x66, 0x33].map((c) => c / 255)
  // The sample's texel position, which the read sets as it samples: the edge runs through its texel.
  let p: V = [0, 0]
  const lit = (t: V) => t[0] >= Math.floor(p[0])
  for (const [name, depthAt, share] of [
    ['an edge', (t: V) => (lit(t) ? 0.4 : 0.6), () => developCoverage(p, lit)],
    ['all lit', () => 0.4, () => 1],
    ['all shadowed', () => 0.6, () => 0],
  ] as const) {
    const { world, stubs } = sunWorld(0.4, depthAt)
    world.through = colour
    // The world's own transmission, which counts its reads, in place of the stub's.
    const { vsmTransmissionThrough: _, vsmReadClipmap, ...kept } = stubs
    const read = run<{ vsmShadowRead: (...a: unknown[]) => number; testTransmission: () => V }>(
      world,
      SUN_READ,
      {
        ...kept,
        vsmReadClipmap: (h: { id: number }, uvs: V) => {
          const sm = vsmReadClipmap(h, uvs)
          p = sm.mapTexelPos
          return sm
        },
      },
      { translucentShadowFilter: 1 },
    )
    const got = read.vsmShadowRead(MAP, sun, [1.23, 0, -0.71], [0, 1, 0])
    assert.ok(Math.abs(got - share()) < 1e-12, `${name}: ${got} against ${share()}`)
    if (name === 'an edge') assert.ok(got > 0 && got < 1, `${name}: ${got}`)
    assert.equal(world.throughReads, got > 0 ? 1 : 0, `${name}: read once where light passes`)
    assert.deepEqual(read.testTransmission(), got > 0 ? colour : [1, 1, 1], name)
  }
})

test('mode 0 is the point read as it stood, byte for byte, and the word picks the mode', () => {
  const point = functionText(SOURCE, 'vsmShadowFactor')
  // Retaken when the record's fields, the normal offset's floor and the map reads took their names
  // here, when the light direction no read took left the signature and when the perspective divide
  // took its library name: the same body.
  assert.equal(
    createHash('sha256').update(point).digest('hex'),
    '50273ccefefc44394a152f9d6581d8bd71ef52d275fdc68c4887244c080d5a04',
  )
  const pick = (source: string) => {
    const called: string[] = []
    const stub = (name: string) => () => (called.push(name), 0.25)
    for (const mode of [0, 1, 2, 7]) {
      const { vsmShadowRead } = run<{ vsmShadowRead: (...a: unknown[]) => number }>(
        new World(),
        ['vsmShadowRead'],
        {
          isSun: () => true,
          vsmShadowFactor: stub('point'),
          vsmShadowFiltered: stub('filtered'),
          vsmShadowTraced: stub('traced'),
        },
        { translucentShadowFilter: mode },
        source,
      )
      vsmShadowRead(9, {}, [0, 0, 0], [0, 1, 0])
    }
    return called
  }
  assert.deepEqual(pick(SOURCE), ['point', 'filtered', 'traced', 'filtered'])
  // The program built without the traces (the setting at 0 or 1) reads 2 as the filtered taps.
  assert.deepEqual(pick(wgslModule(directShadowWgsl(18))), [
    'point',
    'filtered',
    'filtered',
    'filtered',
  ])
})

test('every read is its own: no state is kept from one light to the next', () => {
  // The read itself replaced by a probe that counts and sets a transmission. The water walks its
  // lights once (\`declaredLightingPair\`) and a cell lists a light once: a light is read once.
  const probe = `${SOURCE.replace('fn vsmShadowRead(', 'fn vsmShadowReadShipped(')}
fn vsmShadowRead(id:u32,light:DirectLight,P:vec3f,N:vec3f)->f32{reads=reads+1.0;shadowTransmission=vec3f(0.5,0.25,P.x);return 0.75;}
fn testReads()->f32{return reads;}`
  const f = run<{
    shadowFactor: (...a: unknown[]) => number
    testReads: () => number
    testTransmission: () => V
  }>(
    new World(),
    ['shadowFactor', 'vsmShadowRead', 'testReads', 'testTransmission'],
    { reads: 0 },
    {},
    probe,
  )
  const at = (P: V, slice = 64 * MAP + 1) => [
    f.shadowFactor(slice, {}, P, [0, 1, 0], true),
    f.testTransmission(),
  ]
  assert.deepEqual(at([3, 0, 1]), [0.75, [0.5, 0.25, 3]])
  assert.deepEqual(at([4, 0, 1], 64 * MAP + 2), [0.75, [0.5, 0.25, 4]])
  assert.deepEqual(at([3, 0, 1]), [0.75, [0.5, 0.25, 3]])
  assert.equal(f.testReads(), 3)
})
