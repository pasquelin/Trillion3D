// The traced translucency's trace (`traceWgsl.ts`): the program assembles, its bindings clear those of the cut's tables, its groups stay in WebGPU's limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  RTT_TRACE_BINDINGS,
  tracedTranslucencyEntries,
  tracedTranslucencyProgram,
  tracedTranslucencySceneEntries,
} from './traceWgsl.ts'

const code = tracedTranslucencyProgram()

test('the trace assembles, its own text holds no backtick', () => {
  assertProgramAssembles(code)
  assert.ok(!code.slice(code.indexOf('struct RttParams')).includes('`'))
})

test('group 0 binds each binding once, the scene trace has its own group', () => {
  const bindings = tracedTranslucencyEntries().map((e) => e.binding)
  assert.equal(new Set(bindings).size, bindings.length)
  assert.ok(tracedTranslucencySceneEntries().length > 0)
  for (const at of Object.values(RTT_TRACE_BINDINGS)) assert.ok(bindings.includes(at))
})

test('the stage holds the sampled textures, storage buffers and storage textures WebGPU allows', () => {
  const entries = tracedTranslucencyEntries()
  assert.ok(entries.filter((e) => e.storageTexture).length <= 4)
  assert.ok(entries.filter((e) => e.buffer?.type === 'read-only-storage').length <= 8 - 3)
})

test('the ray runs from the eye to just short of the opaque depth, over the pixels a transparent surface covers', () => {
  assert.match(code, /rttTracePath\(RttRay\(eye,dir,0\.0,dot\(opaque-eye,dir\)-0\.001\)\)/)
  assert.match(code, /if\(frontZ!=opaqueZ\)/)
})

test('the radiance leaves the pass multiplied by the pre-exposure and held to the most a pixel brings back', () => {
  assert.match(code, /result\.radiance\*rtt\.limits\.z/)
  assert.match(code, /radiance\*=rtt\.limits\.y\/most/)
})

test('the share a surface leaves to a reflection ray is the reflections’ own, and a hit’s material is read by the one resolver, an HLOD actor’s own included', () => {
  assert.ok(!code.includes('rttReflectionAlpha'))
  assert.match(code, /reflectAlpha=reflectionTraceShare\(pathRoughness\*pathRoughness,0u\)/)
  assert.equal(code.match(/fn reflectionTraceShare\(/g)?.length, 1)
  assert.match(code, /s\.material=rttMaterialOf\(hit\.placement,hit\.record\);/)
  assert.match(
    code,
    /fn rttMaterialOf\(placement:u32,record:u32\)->RttMaterial\{\s*let at=stMaterialWordOf\(placement,record\);/,
  )
  assert.equal(code.match(/fn stMaterialWordOf\(/g)?.length, 1)
  assert.ok(!code.includes('rttMaterialFloat3'))
})
