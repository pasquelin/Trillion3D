import assert from 'node:assert/strict'
import test from 'node:test'
import { RAY_TRACED_ENTRY, rayTracedProgram } from './rayTracedWgsl.ts'

test('the kernel is a program with its entry, the scene trace and the sequence the samples are drawn from', () => {
  const code = rayTracedProgram()
  assert.ok(code.includes(`fn ${RAY_TRACED_ENTRY}(`))
  assert.ok(code.includes('fn stTrace('))
  assert.ok(code.includes('fn ptRandCreateDiffused('))
  assert.ok(code.includes('fn sampleSphericalRect('))
})

test('the scene trace sits in group 2 and the cut tables it walks at the culling bindings, clear of the kernel’s own', () => {
  const code = rayTracedProgram()
  assert.ok(code.includes('@group(2) @binding(0)'))
  for (const binding of [0, 2, 3, 4, 5, 8, 10])
    assert.ok(code.includes(`@group(0) @binding(${binding})`))
})

test('a shadow ray passes the translucent primitives, ends at the first hit on the setting, and the start leaves the surface', () => {
  const code = rayTracedProgram()
  assert.ok(code.includes('ST_SHADOW|ST_SKIP_TRANSLUCENT'))
  assert.ok(code.includes('params.flags.z!=0u){rayFlags|=ST_ANY_HIT;}'))
  assert.ok(code.includes('ST_CULL_BACK'))
  assert.ok(code.includes('fn rtOrigin('))
})

test('a tube is sampled as a capsule, the back faces of the surfaces light goes through are kept, and the nearest blocker and the thickness are measured', () => {
  const code = rayTracedProgram()
  assert.ok(code.includes('fn rtTube('))
  assert.ok(code.includes('fn sampleCapsule('))
  assert.ok(code.includes('fn rtThroughSurface('))
  assert.ok(code.includes('fn rtTransmission('))
  assert.ok(code.includes('lightChannelsOf(light)&channelsOfFlags(word)'))
  assert.ok(code.includes('textureStore(hitDistances,'))
})

test('the thickness ray skips the first part at the pixel’s end, and a fade of no length switches at once', () => {
  const code = rayTracedProgram()
  assert.ok(code.includes('-D,0.0,max(span-restart,0.0),'))
  assert.ok(code.includes('select(1.0,saturate((depth-params.lod.x)/fade),fade>0.0)'))
})
