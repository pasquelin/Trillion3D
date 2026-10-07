// The GPU writes the cut's difference itself — each list's entries and exits —, and the host
// follows it alone: on generated scene families of separate meshes — cooked DAG primitives and flat
// quads, on grids of two sizes — a still camera applies no change after its first readbacks, a
// moving one applies the changes its lists made, never their lengths; and the lists the host holds
// are the readbacks' own, as sets, frame after frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { quadScene } from '../pages/testScenes.fixture.ts'
import { createWebgpuPagesRuntime } from '../pages/runtime.ts'
import { prepareWebgpuBackend } from '../pages/prepare/prepare.ts'
import { renderWebgpuPages } from '../pages/render/render.ts'
import { flushWebgpuPages } from '../pages/render/flush.ts'
import type { CutDelta } from './delta.ts'

/** `side`² separate meshes of `fixture`'s one mesh, `gap` apart. */
function family(fixture: ReturnType<typeof dagFixture>, side: number, gap: number) {
  const mesh = fixture.source.children[0] as G.Mesh,
    link = fixture.associations.get(mesh as never)
  fixture.source.remove(mesh)
  const associations = new Map()
  for (let k = 0; k < side * side; k++) {
    const copy = G.mesh(mesh.geometry, mesh.material as never)
    copy.position.set((k % side) * gap, 0, -Math.floor(k / side) * gap)
    fixture.source.add(copy)
    associations.set(copy, link)
  }
  fixture.source.updateMatrixWorld(true)
  return { ...fixture, associations }
}

const asSet = (ids: ArrayLike<number>, count = ids.length) =>
  [...new Set(Array.from(ids).slice(0, count))].sort((a, b) => a - b)

const FAMILIES: Array<[string, () => ReturnType<typeof dagFixture>, number, number]> = [
  ['cooked DAG meshes, 10 × 10', dagFixture, 10, 6],
  ['cooked DAG meshes, 30 × 30', dagFixture, 30, 6],
  ['flat quads, 30 × 30', () => quadScene() as never, 30, 3],
]

test('the host applies the changes the GPU took, never the lists, and holds the lists it read', async () => {
  for (const [name, make, side, gap] of FAMILIES) {
    installGpuGlobals()
    const gpu = mockGpu({
      limits: { maxBufferSize: 1 << 26, maxStorageBufferBindingSize: 1 << 26 },
    })
    const scene = family(make(), side, gap)
    const rt = createWebgpuPagesRuntime({
      ...scene,
      gpuDevice: gpu.device,
      maxResidentPages: 8 * side * side,
      viewport: [128, 72],
    })
    await prepareWebgpuBackend(rt, gpu.device)
    const view = rt.views.main.cut!
    let changes = 0
    const watched = (delta: CutDelta) =>
      delta.watch((applied) => void (changes += applied.enteredCount + applied.exitedCount))
    watched(view.asked)
    watched(view.drawn)
    const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 4000),
      span = side * gap,
      centre = [span / 2, 0, -span / 2]
    const counts = { still: 0, moving: 0, lists: 0 }
    for (let frame = 0; frame < 14; frame++) {
      const moving = frame >= 6,
        a = moving ? (frame - 6) * 0.15 : 0
      cam.position.set(centre[0] + span * Math.sin(a), 0.72 * span, centre[2] + span * Math.cos(a))
      cam.lookAt(centre[0], 0, centre[2])
      cam.updateMatrixWorld()
      changes = 0
      renderWebgpuPages(rt, cam)
      await flushWebgpuPages(rt)
      const cut = rt.run.gpuSelection!.peek()!.result
      if (frame >= 3 && !moving) counts.still += changes
      if (moving) {
        counts.moving += changes
        counts.lists += cut.pageIds.length + (cut.drawablePageIds?.length ?? 0)
      }
      // The lists the host holds are the readback's, whatever it followed them by.
      if (!cut.truncated) {
        assert.deepEqual(
          asSet(view.asked.ids, view.asked.count),
          asSet(cut.pageIds),
          `${name} ${frame}`,
        )
        assert.deepEqual(
          asSet(view.drawn.ids, view.drawn.count),
          asSet(cut.drawablePageIds ?? []),
          `${name} ${frame}: drawn`,
        )
      }
    }
    assert.equal(counts.still, 0, `${name}: a still camera changes nothing`)
    assert.ok(
      counts.moving < counts.lists,
      `${name}: ${counts.moving} changes of ${counts.lists} ids`,
    )
    console.log(`${name}: moving, ${counts.lists} ids read before, ${counts.moving} changes now`)
  }
})
