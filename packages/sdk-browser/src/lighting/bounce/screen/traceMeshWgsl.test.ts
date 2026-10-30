// The meshes' fields stage of the screen probes (`traceMeshWgsl.ts`): the program it assembles, the layout of its group 2 and its skip of the rays it answered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MESH_TRACE_BINDING } from '../../rays/meshTrace/traceWgsl.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  TRACE_MESH_GROUP,
  compactMeshShader,
  TRACE_MESH_LIST,
  traceMeshEntries,
  traceMeshListEntries,
  traceMeshShader,
} from './traceMeshWgsl.ts'

test('the meshes’ stage is the scene stage’s program with its own entry beside it', () => {
  for (const fog of [false, true]) {
    const program = traceMeshShader(8, [4, 4], fog, undefined, false)
    assert.match(program, /fn traceMeshes\(/)
    assert.match(program, /fn traceScene\(/, 'the scene stage’s code is the same')
    assert.ok(program.length > traceSceneShader(8, [4, 4], fog, [], undefined, false).length)
  }
})

test('a ray the meshes answered carries the mesh bit and the scene stage leaves it', () => {
  const program = traceMeshShader(8, [4, 4], false, undefined, false)
  assert.match(program, /const SP_MESH_HIT:u32=0x80000000u;/)
  assert.match(program, /textureLoad\(hitIo,texel\)\.r&SP_MESH_HIT\)!=0u/)
  assert.match(program, /\|SP_MESH_HIT/, 'a hit of the meshes writes the bit')
})

test('its group 2 holds the meshes’ fields, then the grid’s uniform, cells and lists', () => {
  const bindings = traceMeshEntries().map(({ binding }) => binding)
  assert.deepEqual(
    [...bindings].sort((a, b) => a - b),
    [
      ...Array(7).keys(),
      MESH_TRACE_BINDING.params,
      MESH_TRACE_BINDING.cells,
      MESH_TRACE_BINDING.indices,
    ],
  )
  assert.equal(TRACE_MESH_GROUP, 2)
})

test('the first compaction lists the rays the screen left that the meshes are traced for, in the order of their threads, and the trace runs over that list alone', () => {
  for (const compaction of ['native', 'polyfill'] as const) {
    const code = compactMeshShader(8, [4, 4], compaction)
    assertProgramAssembles(code, 'compactMeshRays', `compactMeshRays ${compaction}`)
    // The probe nearer the camera than the farthest a mesh is traced at, the screen's miss before the farthest a ray marches the meshes.
    assert.match(code, /ray\.probe\.depth\*100\.0<msdf\.distances\.x/)
    assert.match(code, /<msdf\.distances\.y\*0\.01/)
    assert.match(code, /let slot=spCompactRank\(wants,lane\);/)
    assert.match(
      code,
      /if\(lane==0u&&count>0u\)\{meshBase=meshRaysAppend\(count,WORKGROUP_THREADS\);\}/,
    )
    assert.equal(/enable subgroups;/.test(code), compaction === 'native')
    assert.doesNotMatch(
      code,
      /fn traceMeshes\(|fn traceScene\(/,
      'a program of its own, not the scene stage’s',
    )
    assert.doesNotMatch(
      code,
      /msdfTraceCell|loadDfObjectData/,
      'the meshes’ fields are not declared',
    )
  }
  const trace = traceMeshShader(8, [4, 4], false, undefined, false)
  assertProgramAssembles(trace, 'traceMeshes', 'traceMeshes')
  assert.match(trace, /let ray=spListedMesh\(id,groups\);/)
  // The cut the compaction makes is not made a second time, thread by thread.
  assert.doesNotMatch(trace, /probe\.depth\*100\.0>=msdf/)
  assert.doesNotMatch(trace, /missed>=farthest/)
  assert.match(trace, /fn traceScene\(/, 'the scene stage runs over the whole list, unchanged')
})

test('the list of the rays the meshes are traced for is written by the compaction and read by the trace, each in a group of its own', () => {
  assert.equal(TRACE_MESH_LIST, 3)
  assert.equal(traceMeshListEntries(true)[0].buffer?.type, 'storage')
  assert.equal(traceMeshListEntries(false)[0].buffer?.type, 'read-only-storage')
})
