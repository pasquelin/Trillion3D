// The meshes' fields stage of the screen probes (`traceMeshWgsl.ts`): the program it assembles, the layout of its group 2 and its skip of the rays it answered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MESH_TRACE_BINDING } from '../../rays/meshTrace/traceWgsl.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'
import { TRACE_MESH_GROUP, traceMeshEntries, traceMeshShader } from './traceMeshWgsl.ts'

test('the meshes’ stage is the scene stage’s program with its own entry beside it', () => {
  for (const fog of [false, true]) {
    const program = traceMeshShader(8, [4, 4], fog)
    assert.match(program, /fn traceMeshes\(/)
    assert.match(program, /fn traceScene\(/, 'the scene stage’s code is the same')
    assert.ok(program.length > traceSceneShader(8, [4, 4], fog).length)
  }
})

test('a ray the meshes answered carries the mesh bit and the scene stage leaves it', () => {
  const program = traceMeshShader(8, [4, 4], false)
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
