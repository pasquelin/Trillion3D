import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_BINDING, dagBindEntries } from './bindings.ts'
import { DAG_SELECTION_SHADER } from './shader.ts'
import {
  entryBufferBindings,
  wgslBufferBindings,
  wgslTextureBindings,
} from '../../core/wgslBindings.fixture.ts'
import { unresolvedNames } from '../../core/wgslNames.fixture.ts'

/** The layout's buffer entries, and its texture entries' bindings, sampled or storage. */
const buffers = () => entryBufferBindings(dagBindEntries().filter((entry) => entry.buffer))
const textures = () =>
  dagBindEntries()
    .filter((entry) => entry.texture || entry.storageTexture)
    .map((entry) => entry.binding)

test('the DAG layout entries are the bindings the selection shader declares', () => {
  const declared = wgslBufferBindings(DAG_SELECTION_SHADER)
  assert.equal(declared.length, 3, 'the uniforms, the readout and `work`, whatever the world')
  assert.deepEqual(buffers(), declared)
  // Every other table is a record table (`../cutTables.ts`), no storage buffer of the stage's
  // eight; the flags the one the kernels write, a storage texture.
  const records = ['clusters', 'nodes', 'flags', 'worlds', 'frames', 'cold', 'tree'] as const
  const bindings = records.map((name) => DAG_BINDING[name])
  assert.deepEqual(textures(), bindings)
  assert.deepEqual(wgslTextureBindings(DAG_SELECTION_SHADER), bindings)
  assert.deepEqual(
    dagBindEntries()
      .filter((entry) => entry.storageTexture)
      .map((entry) => entry.binding),
    [DAG_BINDING.flags],
  )
})

test('a binding whose access changes in the shader no longer matches the entries', () => {
  const drifted = DAG_SELECTION_SHADER.replace(
    '@binding(5) var<storage, read_write> work',
    '@binding(5) var<storage, read> work',
  )
  assert.notEqual(drifted, DAG_SELECTION_SHADER)
  assert.notDeepEqual(buffers(), wgslBufferBindings(drifted))
})

test('each DAG buffer name owns its own binding, from 0 without a gap', () => {
  const bindings = Object.values(DAG_BINDING).sort((a, b) => a - b)
  assert.deepEqual(bindings, [...bindings.keys()])
})

test('every name the selection shader uses is one it declares, or WGSL its own', () => {
  // A merge that drops a helper still used elsewhere leaves a shader no device compiles.
  assert.deepEqual(unresolvedNames(DAG_SELECTION_SHADER), [])
  const dropped = DAG_SELECTION_SHADER.replace('fn unculledOf(', 'fn unculledOfGone(')
  assert.deepEqual(unresolvedNames(dropped), ['unculledOf'])
})
