// A parent composed on the GPU moves its children with no CPU row write: their shadows follow as a
// moved node's do. Its move declares the box of every child it holds at its last world and at its
// new one; its first move makes them moving casters, its later ones stale the moving casters
// alone, and at rest they turn static with one box where the parent now holds them. A still
// parent declares nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { composedSlotBox } from './composeBoxes.ts'
import { composeRuntime } from './composeRuntime.fixture.ts'
import { createPlacementRows } from './rows.ts'
import { VsmLightCache, type VsmCacheManager } from '../vsm/cacheManager.ts'
import { vsmInvalidationPhaseFromShadowBoxes } from '../vsm/invalidationPass.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** A parent's world: a translation to `x` along the first axis. */
const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]

/** A sun's cache and a local light's (`lamp` metres around `origin`), both holding cached pages. */
function lights(origin: [number, number, number], lamp: number) {
  const sun = new VsmLightCache('sun', 1),
    local = new VsmLightCache('lamp', 6)
  sun.mapId = 0
  local.mapId = 1
  sun.renderedFrame = local.renderedFrame = 1
  local.lightOrigin = origin
  local.lightRange = lamp
  const entries = new Map([
    ['sun', sun],
    ['lamp', local],
  ])
  return { acceptsInvalidations: () => true, entries } as unknown as VsmCacheManager
}

/** The shadow maps each declared box invalidates (`vsmInvalidationPhaseFromShadowBoxes`). */
function invalidated(rt: WebgpuPagesRuntime, cache: VsmCacheManager) {
  const { changes } = rt.lights,
    maps: number[][] = Array.from({ length: changes.count }, () => [])
  const phase = vsmInvalidationPhaseFromShadowBoxes(cache, changes)
  for (const { firstInstance, payload } of phase?.batch.instances ?? [])
    maps[firstInstance].push(payload)
  return maps
}

test("a linked parent's move stales its children's shadow pages where they stood and where they land, a sun's and a local light's", () => {
  const rows = createPlacementRows(2)
  const rt = composeRuntime(
    [0, 1].map((index) => ({
      placement: { rows, index },
      world: { elements: new Float32Array(at(index * 2)) },
      localBox: Float64Array.from([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    })),
  )
  const { mobility, changes } = rt.lights
  mobility.ensure(2, 2, (rank) => rt.layout.selectionRoots[rank].world.elements)
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: at(index * 2) }))
  composeWebgpuPlacements(rt, parent, at(0), links, true)
  assert.equal(changes.count, 0, "the link: its rows' own CPU write declares them")
  composeWebgpuPlacements(rt, parent, at(0), [], false)
  assert.equal(changes.count, 0, 'a still parent stales nothing')
  assert.equal(mobility.moves(0) || mobility.moves(1), false)

  // The lamp lights where the children land, not where they stood.
  const cache = lights([11, 0, 0], 2)
  composeWebgpuPlacements(rt, parent, at(10), [], false)
  const box = (b: number) => {
    const { min, max, moving } = changes.read(b)
    return { box: [...min, ...max], moving }
  }
  assert.deepEqual(
    [box(0), box(1)],
    [
      { box: [-0.5, -0.5, -0.5, 2.5, 0.5, 0.5], moving: false },
      { box: [9.5, -0.5, -0.5, 12.5, 0.5, 0.5], moving: false },
    ],
    'its first move: the boxes of every child at the old world and the new, the static casters staled',
  )
  assert.equal(mobility.moves(0) && mobility.moves(1), true, 'its children are moving casters')
  assert.deepEqual(invalidated(rt, cache), [[0], [0, 1, 2, 3, 4, 5, 6]])
  changes.settled()

  composeWebgpuPlacements(rt, parent, at(11), [], false)
  assert.deepEqual(
    [box(0), box(1)],
    [
      { box: [9.5, -0.5, -0.5, 12.5, 0.5, 0.5], moving: true },
      { box: [10.5, -0.5, -0.5, 13.5, 0.5, 0.5], moving: true },
    ],
    'a later move stales the moving casters alone',
  )
  assert.deepEqual(invalidated(rt, cache), [
    [0, 1, 2, 3, 4, 5, 6],
    [0, 1, 2, 3, 4, 5, 6],
  ])
  changes.settled()

  // At rest past the threshold, the children turn static: the slot's box, where the parent now
  // holds them, once for both.
  const settled: [number, number, number[]][] = []
  for (let frame = 0; frame < 5; frame++)
    mobility.settle(3, (rank, lead) => settled.push([rank, lead, [...composedSlotBox(rt, lead)!]]))
  assert.equal(settled.length, 1)
  assert.deepEqual(settled[0][2], [10.5, -0.5, -0.5, 13.5, 0.5, 0.5])
  assert.equal(mobility.moves(0) || mobility.moves(1), false)
  composeWebgpuPlacements(rt, parent, at(12), [], false)
  assert.equal(box(0).moving || box(1).moving, false, 'the next move promotes them again')
})
