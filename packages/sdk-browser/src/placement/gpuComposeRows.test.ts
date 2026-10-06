// The page-table row a linked root is drawn from is the row the CPU writes, word for word, while
// nothing moved on the GPU alone: a group of crystals turns once and its children are linked with
// the rows' own CPU write (`../world/core/worldPoses.ts`), then the scene stays still. Every word of
// every row the CPU path leaves is compared with the words the compose rows pass (`composeRow`, the
// shipped WGSL) leaves over the same CPU write. A parent turned on the GPU then makes the row's
// corners stale: it takes no Hi-Z verdict until the CPU writes it again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_HIZ_SLOT_WORD } from '../webgpu/row/pageRow.ts'
import { NO_HIZ_SLOT } from '../webgpu/row/noHizSlot.ts'
import { MATRIX_DOUBLES } from './gpuComposeWgsl.ts'
import { composeRows, cpuTable, crystals, N, WORDS } from './gpuComposeRows.fixture.ts'

const differing = (a: Uint32Array, b: Uint32Array) => {
  const out: string[] = []
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) out.push(`row ${Math.floor(i / WORDS)} word ${i % WORDS}`)
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

  // The group turns on the GPU alone: the world words are the CPU's world of that turn, and the
  // corners the row keeps are the last write's, so no occlusion test judges it.
  group.rotation.y = -0.2
  settle()
  const turned = cpuTable(meshes)
  composed = composeRows(composed, group.matrixWorld.elements, locals)
  const moved = differing(turned, composed)
  assert.equal(moved.length, N, 'only the Hi-Z slot differs, on every row')
  assert.ok(moved.every((at) => at.endsWith(`word ${ROW_HIZ_SLOT_WORD}`)))
  for (let row = 0; row < N; row++)
    assert.equal(composed[row * WORDS + ROW_HIZ_SLOT_WORD], NO_HIZ_SLOT)
  composed = composeRows(composed, group.matrixWorld.elements, locals)
  assert.equal(composed[ROW_HIZ_SLOT_WORD], NO_HIZ_SLOT, 'still stale on the next still frame')
  // The CPU writes the rows again (a full write): they are its rows once more.
  assert.deepEqual(differing(turned, composeRows(turned, group.matrixWorld.elements, locals)), [])
})
