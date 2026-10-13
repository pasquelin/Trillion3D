// The page-table row a linked root is drawn from is the row the CPU writes, word for word, while
// nothing moved on the GPU alone: a group of crystals turns once and its children are linked with
// the rows' own CPU write (`../world/core/worldPoses.ts`), then the scene stays still. Every word of
// every row the CPU path leaves is compared with the words the compose rows pass (`composeRow`, the
// shipped WGSL) leaves over the same CPU write. A parent turned on the GPU makes the row's world words
// the CPU's of that turn, and nothing else: its Hi-Z slot stays the row's own, its corners being
// derived from the composed world (`gpuComposeDerived.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_HIZ_SLOT_WORD } from '../webgpu/row/pageRow.ts'
import { MATRIX_DOUBLES } from './gpuComposeWgsl.ts'
import { composeRows, cpuTable, crystals, N } from './gpuComposeRows.fixture.ts'
import { ROW_WORDS } from '../visibility/types.ts'

const differing = (a: Uint32Array, b: Uint32Array) => {
  const out: string[] = []
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) out.push(`row ${Math.floor(i / ROW_WORDS)} word ${i % ROW_WORDS}`)
  return out
}

test('a group turned once and linked by its rows own write leaves every row word as the CPU writes it', () => {
  assert.equal(MATRIX_DOUBLES, 16)
  const { group, meshes, settle } = crystals()
  settle()
  group.rotation.y = -0.6
  settle()
  // The CPU path: the rows written after the turn. The composed path: the same write, then the
  // links (the group's world, each child's local matrix) composed over it, frame after frame.
  const cpu = cpuTable(meshes)
  const locals = meshes.map((mesh) => mesh._matrixElements.slice())
  let composed = composeRows(cpu, group.matrixWorld.elements, locals)
  assert.deepEqual(differing(cpu, composed), [], 'the link frame')
  composed = composeRows(composed, group.matrixWorld.elements, locals)
  assert.deepEqual(differing(cpu, composed), [], 'a still frame after it')

  // The group turns on the GPU alone: the row words are those the CPU writes for that turn, the
  // Hi-Z slot the row's own.
  group.rotation.y = -0.2
  settle()
  const turned = cpuTable(meshes)
  composed = composeRows(composed, group.matrixWorld.elements, locals)
  assert.deepEqual(differing(turned, composed), [], 'every word of every row')
  for (let row = 0; row < N; row++) assert.equal(composed[row * ROW_WORDS + ROW_HIZ_SLOT_WORD], row)
})
