import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { layoutProblems } from '../../../gpu/core/wgslLayoutMatch.fixture.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { rayTracedAoKit } from './rayTracedAoMethod.ts'
import { RAY_TRACED_AO_ENTRY, RAY_TRACED_AO_FORMAT, rayTracedAoProgram } from './rayTracedAoWgsl.ts'

test('the kernel is a program with its entry, the scene trace, the sequence the samples are drawn from and the cosine map', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes(`fn ${RAY_TRACED_AO_ENTRY}(`))
  assert.ok(code.includes('fn stTrace('))
  assert.ok(code.includes('fn ptRandCreateDiffused('))
  assert.ok(code.includes('fn uniformDiskConcentric('))
  assert.ok(code.includes('fn frameAround('))
})

test('the scene trace sits in group 2 and the cut tables it walks at the culling bindings, clear of the kernel’s own', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes('@group(2) @binding(0)'))
  for (const binding of [0, 2, 3, 4]) assert.ok(code.includes(`@group(0) @binding(${binding})`))
  assert.ok(code.includes(`texture_storage_2d<${RAY_TRACED_AO_FORMAT},write>`))
})

test('a ray is a shadow ray of the nearest hit that passes the translucent primitives, culls back faces and masks on the settings, and starts off the surface', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes('ST_SHADOW|ST_SKIP_TRANSLUCENT'))
  assert.ok(!code.includes('rayFlags|=ST_ANY_HIT'))
  assert.ok(code.includes('params.flags.y==0u){rayFlags|=ST_CULL_BACK;}'))
  assert.ok(code.includes('params.flags.z==0u){rayFlags|=ST_FORCE_OPAQUE;}'))
  assert.ok(code.includes('rayOrigin(P,N,direction,params.trace.z,0.0001)'))
  assert.ok(code.includes('fn rayOrigin('))
})

test('the kernel writes the distance of the nearest hit beside the occlusion: 100 metres where none was blocked (a hit, or a walk stopped before it was whole), below zero where no ray was cast', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes('var closest=100.0;'))
  assert.ok(code.includes('if(blocked){closest=min(closest,min(hit.distance,stReached));}'))
  assert.ok(code.includes('stReached=max(t,stRay.tMin);'))
  assert.ok(code.includes('vec4f(result,select(-2.0,closest,samples>0u),0.0,0.0)'))
})

test('the weight of a ray is the shading cosine over the geometric one, each held to a twentieth, and a blocked ray leaves what the intensity leaves', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes('max(dot(N,direction),0.05)/max(cosine,0.05)'))
  assert.ok(code.includes('let blocked=hit.hit||!stComplete;'))
  assert.ok(code.includes('select(1.0,1.0-params.trace.y,blocked)'))
  assert.ok(code.includes('result=geometry.overlap*seen/count;'))
})

test('the geometric normal comes from the neighbours inside the window, the foliage and the silhouettes keep the shading normal, and the lobes’ overlap is a Gaussian product', () => {
  const code = rayTracedAoProgram()
  assert.ok(code.includes('clamp(pixel+offset,low,high)'))
  assert.ok(code.includes('if(thin){return RtAoGeometry(N,1.0);}'))
  assert.ok(code.includes('across<-5.0*radius||down<-5.0*radius'))
  assert.ok(code.includes('2.133'))
  assert.ok(code.includes('1.17'))
})

test('the kernel binds what its text declares: each binding it reaches is in the kernel’s, the reflection’s or the scene trace’s layout, of the kind and format it reads', () => {
  const { device, bindGroupLayouts } = fakeDevice()
  const gpu = device as unknown as GPUDevice
  const kit = rayTracedAoKit(gpu)
  reflectionLayout(gpu)
  const entriesOf = (label: string) =>
    bindGroupLayouts.find((layout) => layout.label === label)!.entries as GPUBindGroupLayoutEntry[]
  const groups = [
    entriesOf('Trillion3D ray traced ambient occlusion'),
    entriesOf((reflectionLayout(gpu) as unknown as { label: string }).label),
    entriesOf('Trillion3D ray traced ambient occlusion scene trace'),
  ]
  assert.ok(kit.layout && kit.scene)
  assert.deepEqual(layoutProblems(rayTracedAoProgram(), groups, RAY_TRACED_AO_ENTRY), [])
})
