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
