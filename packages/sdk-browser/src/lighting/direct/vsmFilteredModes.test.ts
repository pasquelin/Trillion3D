// The blended and water read in every mode over a sun straight down (`vsmFilteredRead.test.ts`): the
// exact 0 and 1, the traced dither, the words of the uniforms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_UNIFORMS_WGSL, writeVsmUniforms } from '../../vsm/uniforms.ts'
import { vsmProjectionWgsl } from '../../vsm/projectionWgsl.ts'
import { vsmTraceWgsl } from '../../vsm/traceWgsl.ts'
import { wgslStructLayout } from '../../vsm/wgslStructLayout.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { type V, MAP, run } from './vsmFilteredRead.fixture.ts'
import { SUN_READ as READ, sunWorld } from './vsmFilteredSample.fixture.ts'
import { VSM_UNIFORMS_BYTES } from '../../vsm/constants.ts'
import { vsmLayout } from '../../vsm/layout.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Read = { vsmShadowRead: (...a: unknown[]) => number; testTransmission: () => V }

test('a receiver at one depth reads exactly 0 or 1 in every mode', () => {
  const sun = { directionCone: [0, -1, 0, 0], shape: [0.005, 0, 0, 0], params: [2, 0, 0, 0] }
  for (const mode of [0, 1, 2])
    for (const stored of [0.6, 0.4]) {
      const { world, stubs } = sunWorld(stored)
      const read = run<Read>(world, READ, stubs, { translucentShadowFilter: mode })
      // The receiver at y = 0, a hair above it by the normal bias: depth 0.5.
      const at = read.vsmShadowRead(MAP, sun, [1.23, 0, -0.71], [0, 1, 0])
      assert.equal(at, stored > 0.5 ? 0 : 1, `mode ${mode}, stored ${stored}`)
    }
})

test('the traced read dithers a penumbra by at most a thirtieth and leaves 0 and 1 exact', () => {
  const sun = { directionCone: [0, -1, 0, 0], shape: [0.005, 0, 0, 0], params: [2, 0, 0, 0] }
  // The shades a trace returns: k of R rays, R at most VSM_MASK_MAX_RAYS (1/15 the least above 0).
  for (const traced of [0, 1, 0.5, 1 / 15]) {
    const { world, stubs } = sunWorld(0.4)
    let transmission = 0
    const read = run<Read>(
      world,
      READ,
      {
        ...stubs,
        vsmTraceSun: () => ({ shadowFactor: traced }),
        vsmTransmissionThrough: () => (transmission++, [1, 1, 1]),
      },
      { translucentShadowFilter: 2 },
    )
    const at = read.vsmShadowRead(MAP, sun, [1.23, 0, -0.71], [0, 1, 0])
    if (traced === 0 || traced === 1) assert.equal(at, traced)
    else assert.ok(Math.abs(at - traced) <= 1 / 30 + 1e-12, `${at}`)
    assert.equal(transmission, traced > 0 ? 1 : 0, 'the point read’s transmission where lit')
  }
})

test('only the blended and water reads switch: the opaque resolve reads its mask, and no pool', () => {
  const resolve = wgslModule(directShadowWgsl(25, { resolveTransmission: 14 })),
    blend = wgslModule(directShadowWgsl(18))
  assert.doesNotMatch(blend, /vsmShadowTraced|vsmTraceSun/, 'no traces in the default')
  assert.doesNotMatch(resolve, /vsmShadowRead|vsmFilterTaps|vsmTraceSun|translucentShadowFilter;/)
  assert.doesNotMatch(resolve, /return vsmShadowFactor\(|vsmMaskPixel\.x>=0|vsmPool0/)
  assert.match(blend, /return vsmShadowRead\(u32\(slice\)>>6u,light,P,N\);/)
  assert.match(blend, /let mode=vsm\.translucentShadowFilter;/)
})

test('the mode and the view tangent have their words in the uniforms, the default the setting', () => {
  const { offsets, size } = wgslStructLayout(wgslSource(VSM_UNIFORMS_WGSL), 'VsmUniforms')
  assert.equal(size, VSM_UNIFORMS_BYTES)
  assert.equal(offsets.translucentShadowFilter, 12)
  assert.equal(offsets.viewTanHalfFovY, 84)
  assert.equal(offsets.pageTableSize, 40, 'the fields around them do not move')
  assert.equal(offsets.markMipOffset, 144)
  const layout = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27)
  const frame = {
    fullMapCount: 1,
    singlePageMapCount: 0,
    frameStamp: 9,
    pressureBias: 0,
  }
  const out = new ArrayBuffer(VSM_UNIFORMS_BYTES)
  writeVsmUniforms(out, layout, frame)
  assert.equal(new Uint32Array(out)[3], LIGHT_SETTINGS.translucentShadowFilter)
  assert.equal(LIGHT_SETTINGS.translucentShadowFilter, 1, 'the filtered read by default')
  assert.equal(new Float32Array(out)[21], 0)
  writeVsmUniforms(out, layout, { ...frame, translucentShadowFilter: 2, viewTanHalfFovY: 0.5 })
  assert.equal(new Uint32Array(out)[3], 2)
  assert.equal(new Float32Array(out)[21], 0.5)
})

test('the traced read runs the projection’s traces without its wave votes', () => {
  const projection = vsmProjectionWgsl(
    vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27),
    { subgroups: false },
  )
  assert.ok(projection.includes(vsmTraceWgsl(true).text), 'the compute projection votes')
  assert.equal(wgslSource(vsmTraceWgsl(true)).match(/vsmVoteAllTrue\(/g)?.length, 5)
  assert.equal(wgslSource(vsmTraceWgsl(false)).match(/vsmVoteAllTrue\(/g), null)
  const blend = wgslModule(directShadowWgsl(18, { traced: true }))
  assert.ok(blend.includes(vsmTraceWgsl(false).text), 'a fragment traces every ray')
  assert.match(blend, /anyCrossing=running&&startFace\.id!=endFace\.id;/)
})
