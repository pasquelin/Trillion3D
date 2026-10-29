// The reservoir gather: its programs are modules a device takes, and carry the steps of the reference's passes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { imageEntries, imageProgram, IMAGE_ENTRIES } from './imageWgsl.ts'
import { PARAM_SLOT, PARAM_SLOT_BYTES, RESERVOIR_PARAMS } from './params.ts'
import { RESAMPLE_ENTRIES, resampleEntries, resampleProgram } from './resampleWgsl.ts'
import { RESERVOIR_TRACE_ENTRY, reservoirTraceProgram } from './traceWgsl.ts'
import { RESERVOIR_BINDINGS } from './commonWgsl.ts'

test('a slot of parameters is the 256 bytes of a dynamic offset', () => {
  assert.equal(RESERVOIR_PARAMS.words * 4, PARAM_SLOT_BYTES)
  assert.ok(PARAM_SLOT.count > PARAM_SLOT.bilateral)
})

test('the ray kernel is a module a device takes, validating the last reservoirs with the reference’s weights', () => {
  const code = reservoirTraceProgram()
  assertProgramAssembles(code, undefined, RESERVOIR_TRACE_ENTRY)
  assert.match(code, /h\.m\*=clamp\(old\/max\(now,1e-6\),0\.03,1\.0\);/)
  assert.match(code, /h\.w\*=clamp\(old\/max\(now,1e-6\)\*10\.0,0\.01,1\.0\);/)
  assert.match(code, /r\.w=r\.wSum\/max\(r\.m\*aim,0\.00001\);/)
  assert.match(code, /h\.s\.radiance=t\.radiance\/rs\.exposure\.y;/)
})

test('the resampling kernels merge the nine temporal neighbours once and the spiral of spatial ones, as the reference does', () => {
  const code = resampleProgram()
  for (const entry of Object.values(RESAMPLE_ENTRIES))
    assertProgramAssembles(code, undefined, entry)
  assert.match(code, /h\.m=min\(h\.m,20\.0\);/)
  assert.match(code, /let angle=\(f32\(i\)\+noise\+0\.3\*rs\.spatial\.w\)\*2\.3999632;/)
  assert.match(code, /if\(j>10\.0\|\|j<0\.1\)\{j=0\.0;\}/)
  assert.deepEqual(
    resampleEntries().map((e) => e.binding),
    [
      RESERVOIR_BINDINGS.params,
      RESERVOIR_BINDINGS.blue,
      RESERVOIR_BINDINGS.poolA,
      RESERVOIR_BINDINGS.poolB,
      RESERVOIR_BINDINGS.normals,
      RESERVOIR_BINDINGS.vectors,
    ],
  )
})

test('the pixel kernels upsample by the three methods, accumulate over the disocclusion test of four texels and filter bilaterally', () => {
  const code = imageProgram()
  for (const entry of Object.values(IMAGE_ENTRIES)) assertProgramAssembles(code, undefined, entry)
  assert.match(code, /exp2\(-100000\.0\*relative\*relative\)/)
  assert.match(code, /let alpha=1\.0\/\(1\.0\+newFrames\);/)
  assert.match(code, /historyWeight=select\(0\.0,0\.9,onscreen\)/)
  assert.match(code, /if\(radius>=0\.5&&variance>0\.04\)/)
  assert.equal(new Set(imageEntries().map((e) => e.binding)).size, imageEntries().length)
})

test('no WGSL reserved word names anything in the reservoir programs', () => {
  const reserved =
    /\b(?:let|var|fn)\s+(target|set|from|ref|match|meta|pass|patch|mod|of|filter|common|shared|smooth)\b/
  for (const code of [reservoirTraceProgram(), resampleProgram(), imageProgram()])
    assert.doesNotMatch(code, reserved)
})

test('the occlusion trace is a fraction of half the screen’s height with a tolerance in the view’s depth, as the reference’s, and the GGX lobe and the untonemap hold off a zero', () => {
  const resample = resampleProgram()
  assert.match(resample, /let len=rs\.spatial\.y\*rsScreenHeight\(r\.depth\);/)
  assert.match(resample, /let halfHeight=reflectionView\.slab\.x\*0\.5\*view\.viewport\.y;/)
  assert.match(resample, /reflectionView\.slab\.z\/reflectionView\.slab\.x\*len/)
  const image = imageProgram()
  assert.match(image, /let r=max\(rough,0\.01\);/)
  assert.match(image, /c\/max\(1\.0-rsLuma\(c\),0\.000001\)/)
})

test('the reservoir programs hold none of the reference’s names', () => {
  for (const code of [reservoirTraceProgram(), resampleProgram(), imageProgram()])
    assert.doesNotMatch(code, /unreal|epic|lumen|nanite|substrate|megalights|restir/i)
})
