// The placement tree followed on a selection: whatever moved since it was last read is refitted
// before the next read — the CPU's plan of the image, which runs before the cut, as much as the cut.
// On a generated field of placements.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { followPlacementTree } from './treeFollow.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import type { GpuSelection } from '../core/selection.ts'

/** A field of 1600 placements under a followed tree, its selection a stand-in. */
function followed() {
  const roots = placementField(40, 6),
    packed = packDagSelection(roots)
  const writes: number[] = []
  const device = {
    queue: { writeBuffer: (_: unknown, offset: number) => void writes.push(offset) },
  } as unknown as GPUDevice
  const selection = {
    dispatch: () => undefined,
    updateWorlds: () => true,
    parkWorld: () => {},
    markWorld: () => {},
    worldsMovedOnGpu: () => {},
  } as unknown as GpuSelection
  const nodeParts = { buffers: [{} as GPUBuffer], bytes: packed.nodes.byteLength }
  followPlacementTree(selection, { device, packed, nodeParts })
  return { roots, packed, selection, writes }
}

test('a pose moved before the plan is read where it went, before any cut', () => {
  const { roots, packed, selection } = followed()
  ;(roots[70].world.elements as Float64Array)[12] = 1000
  selection.updateWorlds(packed.worlds)
  const seen: number[] = []
  const { planes } = engineCamera(fieldCamera([990, 2, 0], [1000, 0, -50]))
  selection.visiblePlacements!(planes, (w) => seen.push(w))
  assert.ok(seen.includes(70), 'the plan reads the placement at its new pose')
})

test('a pose a call names refits its group and the nodes above it, never the whole tree', () => {
  const { roots, packed, selection, writes } = followed()
  ;(roots[70].world.elements as Float64Array)[12] = 1000
  selection.placementMoved!(70)
  selection.updateWorlds(packed.worlds, true, false)
  selection.dispatch({} as never)
  // Its group and its cell, of the 26 tree nodes: near enough to go up in one write.
  assert.equal(writes.length, 1)
  const seen: number[] = []
  const { planes } = engineCamera(fieldCamera([990, 2, 0], [1000, 0, -50]))
  selection.visiblePlacements!(planes, (w) => seen.push(w))
  assert.ok(seen.includes(70))
  // A host walk names none: every box is fitted again.
  selection.updateWorlds(packed.worlds, true, true)
  selection.dispatch({} as never)
  assert.equal(writes.length, 1 + 1, 'every tree node, in one run')
})

test('a root its parent composes on the GPU opens its group alone, until it is unlinked', () => {
  const { packed, selection } = followed()
  const tree = packed.placementTree!,
    groups = tree.levels.at(-1)!,
    groupOf = (w: number) => Math.floor(tree.slot[w] / 64)
  selection.composedPlacement!(70, true)
  selection.worldsMovedOnGpu()
  selection.dispatch({} as never)
  const open = (g: number) => tree.nodeOpen[groups.base + g - tree.cellBase]
  for (let g = 0; g < groups.count; g++)
    assert.equal(open(g), g === groupOf(70) ? 1 : 0, `group ${g}`)
  selection.composedPlacement!(70, false)
  selection.dispatch({} as never)
  assert.equal(open(groupOf(70)), 0, 'unlinked, its group fits its box again')
})
