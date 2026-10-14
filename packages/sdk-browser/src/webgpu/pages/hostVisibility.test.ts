import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { camera, flushedGpuScene, quadScene } from './testScenes.fixture.ts'
import { prepared } from '../water/pass.fixture.ts'
import { uploadWorlds } from './render/worldUpload.ts'
import { writeKeyRecords } from '../blend/keyRecords.ts'
import { KEY_DRAWN, KEY_RECORD_WORDS, KEY_WORD } from '../blend/keyLayout.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'
import { createChangedRuns } from '../residency/ranges.ts'

// A node of a compiled model hidden once, then shown again, by the host (#407). Every frame
// renders and settles, the GPU cut drops the node's pages while it is hidden — its root parked
// as a parked row's is — and takes them back once it is shown.
test('the WebGPU path hides a compiled node the host hid, and draws it again once shown', async () => {
  installGpuGlobals()
  const scene = quadScene()
  const { backend } = await flushedGpuScene(scene)
  const run = backend as typeof backend & { selectedPageIds(): string[] }
  const node = scene.source.children[0]
  /** One frame, as the interactive loop runs it: drawn, then its pending work awaited. */
  const frame = async () => {
    run.render(camera())
    assert.equal(typeof (await run.pendingFrame()), 'boolean', 'the frame settles')
    return run.selectedPageIds().sort()
  }
  try {
    for (let n = 0; n < 3; n++) assert.deepEqual(await frame(), ['0', '1'])
    node.visible = false
    await frame() // the park voids the cut in hand: the next readback is cut without the node
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), [], 'hidden, none of its pages is drawn')
      assert.equal(run.metrics().submittedTriangles, 0)
    }
    node.visible = true
    await frame()
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), ['0', '1'], 'shown again, it is drawn again')
      assert.equal(run.metrics().submittedTriangles, 2)
    }
  } finally {
    run.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
})

// The same node's see-through parts and shadow: a hidden node vanishes entirely (#407).
test('a host hide parks the root, hides its blend items and stales the shadow pages it covered', () => {
  const { blendState } = prepared()
  const group = new G.Group(),
    node = new G.Group(),
    other = new G.Group()
  group.add(node)
  // The root's node stands for a mesh, which casts unless set otherwise.
  node.castShadow = true
  const [item, kept] = blendState.blendGpu
  item.drawSource = { node } as never
  kept.drawSource = { node: other } as never
  const root = {
    pages: [{ drawSource: { node } }],
    worldBox: new Float64Array([-1, -2, -3, 1, 2, 3]),
  } as unknown as ClusterRoot<PageRec>
  const parks: [number, boolean][] = [],
    marks: number[] = [],
    changed: number[][] = [],
    touched: number[] = []
  const rt = {
    run: {
      gate: { updateWorlds: () => ({ reshaped: true, flipped: [] }), revisions: { scene: 1 } },
      gpuSelection: {
        parkWorld: (rank: number, parked: boolean) => parks.push([rank, parked]),
        markWorld: (_: number, mark: number) => marks.push(mark),
      },
      worldUploadRevision: 1,
      movedWorlds: createChangedRuns(),
    },
    setup: { worlds: {} },
    vis: {},
    layout: { selectionRoots: [root], worldUpdates: [], rows: { tableEpoch: 0 } },
    timing: { worldCounts: {} },
    blendState,
    lights: {
      mobility: { moves: () => false, touch: (rank: number) => touched.push(rank) },
      changes: { worldChanged: (lo: number[], hi: number[]) => changed.push([...lo, ...hi]) },
    },
  } as unknown as WebgpuPagesRuntime
  group.visible = false
  uploadWorlds(rt)
  assert.deepEqual(parks, [[0, true]])
  assert.equal(item.hidden, true, 'the blend item of the hidden node is hidden')
  assert.ok(!kept.hidden, 'another node keeps its blend item')
  const asked = () => (rt as { rowWords?: { roots: number[] } }).rowWords?.roots ?? []
  assert.deepEqual(asked(), [0], 'its rows, derived again, stale its shadow pages')
  assert.deepEqual(changed, [], 'no box declared on the CPU')
  assert.deepEqual(touched, [0], "its rows' words are written anew: the casters skip them")
  // The flip is noted on the item's key record, whose drawn bit the GPU verdict reads.
  const drawnBit = () => writeKeyRecords(blendState)[KEY_WORD.flags] & KEY_DRAWN
  assert.deepEqual(blendState.keyMoved, { from: 0, to: 0 }, 'its key record goes up')
  assert.equal(drawnBit(), 0, 'the frustum verdict keeps it out')
  assert.equal(
    writeKeyRecords(blendState)[KEY_RECORD_WORDS + KEY_WORD.flags] & KEY_DRAWN,
    KEY_DRAWN,
  )
  uploadWorlds(rt)
  assert.equal(asked().length, 1, 'a revision that changes nothing stales nothing')
  group.visible = true
  uploadWorlds(rt)
  assert.deepEqual(parks, [
    [0, true],
    [0, false],
  ])
  assert.equal(item.hidden, false)
  assert.equal(asked().length, 2, 'shown again, its shadow is drawn again')
  assert.deepEqual(touched, [0, 0])
  assert.deepEqual(blendState.keyMoved, { from: 0, to: 0 })
  assert.equal(drawnBit(), KEY_DRAWN)
  // #456: a node set to cast no shadow leaves every light cut; its shadow pages are drawn again.
  node.castShadow = false
  uploadWorlds(rt)
  assert.deepEqual(marks.slice(-1), [SHADOWLESS_ROOT])
  assert.equal(asked().length, 3, 'its shadow is drawn again without it')
  assert.deepEqual(changed, [])
})
