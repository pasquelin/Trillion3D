// The irradiance field's gather: the weights and the reads of the pixels' interpolation of the probes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { FIELD_GATHER_BINDINGS, fieldGatherEntries, fieldGatherProgram } from './gatherWgsl.ts'

test('the field’s gather is a module a device takes, its bindings the layout holds', () => {
  const code = fieldGatherProgram()
  assertProgramAssembles(code, undefined, 'fieldGather')
  assert.deepEqual(
    fieldGatherEntries()
      .map((entry) => entry.binding)
      .sort(),
    Object.values(FIELD_GATHER_BINDINGS).sort(),
  )
  assert.ok(code.includes('fn fieldGather('))
})

test('a probe weighs by its wrap shading, the Chebyshev bound of its occlusion, the crush of a small weight and its trilinear share, as the reference does', () => {
  const code = fieldGatherProgram()
  assert.match(code, /var weight=wrap\*wrap\+0\.2;/)
  assert.match(code, /chebyshev=max\(visible\*visible\*visible,0\.0\);/)
  assert.match(code, /weight=max\(weight\*max\(chebyshev,0\.05\),FIELD_MIN_WEIGHT\);/)
  assert.match(code, /if\(weight<0\.2\)\{weight\*=weight\*weight\/0\.04;\}/)
  // The probe's validity (an inside of a surface weighs a thousandth) is taken in before the trilinear share: `Weight = max(Weight * max(ProbeValid, .001), MinWeight)`, then `Weight *= TrilinearWeight`.
  assert.match(
    code,
    /weight=max\(weight\*max\(select\(0\.0,1\.0,probeValid\[slot-1u\]!=0u\),0\.001\),FIELD_MIN_WEIGHT\)\*trilinear;/,
  )
  assert.match(code, /let S=P\+\(N\*0\.2\+V\*viewBias\)\*\(0\.75\*spacing\*field\[1\]\.x\);/)
  assert.match(code, /answered=select\(1\.0,0\.0,sum\.weight<FIELD_MIN_WEIGHT\*8\.0\*1\.5\);/)
  assert.match(code, /diffuse=mean\*mean;/)
})

test('a probe the validity calls inside a surface weighs a thousandth, and a pixel past the field’s levels takes the sky light as the reference does', () => {
  const code = fieldGatherProgram()
  assert.match(
    code,
    /weight=max\(weight\*max\(select\(0\.0,1\.0,probeValid\[slot-1u\]!=0u\),0\.001\),FIELD_MIN_WEIGHT\)\*trilinear;/,
  )
  assert.match(code, /diffuse=select\(vec3f\(0\.0\),skyLightDiffuse\(N\),sky\);/)
  assert.match(
    code,
    /specular=mix\(select\(vec3f\(0\.0\),skyLightReflection\(reflection,rough\),sky\),diffuse,diffuseLerp\);/,
  )
})

test('the adaptive probes of a cell weigh as its own does and are read when the frame picks the pixel; a miss is counted for the nearest cell with the offset it lies at, in the units of the precision', () => {
  const code = fieldGatherProgram()
  assert.match(code, /let held=adaptiveProbes\[entry\*FIELD_MAX_ADAPTIVE\+rank\]>>16u;/)
  assert.match(
    code,
    /sum=fieldProbe\(sum,held,probePosition\(cell,spacing\)\+shift,P,S,N,reflection,mip,trilinear,withReflection,feedback\);/,
  )
  assert.match(
    code,
    /if\(adaptiveUsed&&weight>FIELD_MIN_WEIGHT\)\{poolSlots\[\(slot-1u\)\*FIELD_SLOT_WORDS\+FIELD_SLOT_USED\]=bounce\.frame\.z;\}/,
  )
  assert.match(
    code,
    /if\(adaptive&&feedback&&answered==0\.0\)\{fieldMiss\(cover\.level,S,spacing\);\}/,
  )
  assert.match(code, /atomicAdd\(&misses\[entry\],1u\);/)
  assert.match(code, /\(S-probePosition\(cell,spacing\)\)\*\(middle\/spacing\)\+vec3f\(middle\)/)
})
