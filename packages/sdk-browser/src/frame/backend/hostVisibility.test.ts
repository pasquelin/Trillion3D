import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { camera, flushedGpuScene, quadScene } from './testScenes.fixture.ts'
import { prepared } from '../../blend/translucentScene.fixture.ts'
import { uploadWorlds } from '../render/worldUpload.ts'
import { writeKeyRecords } from '../../blend/keyRecords.ts'
import { KEY_DRAWN, KEY_RECORD_WORDS, KEY_WORD } from '../../blend/keyLayout.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'
import { FAR_SHADOW_ROOT, SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'

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

// The same node's see-through parts: a hidden node vanishes entirely (#407).
test('a host hide parks the root and hides its blend items', () => {
  const { blendState } = prepared()
  const group = new Group(),
    node = new Group(),
    other = new Group()
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
    touched: number[] = [],
    parkedMobility: number[] = []
  const rt = {
    run: {
      gate: { updateWorlds: () => ({ reshaped: true, flipped: [] }), revisions: { scene: 1 } },
      gpuSelection: {
        parkWorld: (rank: number, parked: boolean) => parks.push([rank, parked]),
        markWorld: (_: number, mark: number) => marks.push(mark),
        drawDistanceWorld: () => {},
        rootParentWorld: () => true,
      },
      worldUploadRevision: 1,
      movedWorlds: createChangedRuns(),
    },
    setup: { worlds: {} },
    vis: {},
    layout: {
      selectionRoots: [root],
      rootIndex: { revision: 0 },
      worldUpdates: [],
    },
    timing: { worldCounts: {} },
    blendState,
    lights: {
      mobility: {
        cachedDynamic: () => false,
        touch: (rank: number) => touched.push(rank),
        park: (rank: number) => parkedMobility.push(rank),
      },
      changes: { worldChanged: (lo: number[], hi: number[]) => changed.push([...lo, ...hi]) },
    },
  } as unknown as WebgpuPagesRuntime
  group.visible = false
  uploadWorlds(rt)
  assert.deepEqual(parks, [[0, true]])
  assert.equal(item.hidden, true, 'the blend item of the hidden node is hidden')
  assert.ok(!kept.hidden, 'another node keeps its blend item')
  assert.deepEqual(changed, [], 'no box declared on the CPU')
  assert.deepEqual(touched, [0], 'its mobility is told: the casters skip it')
  assert.deepEqual(parkedMobility, [0], 'its cache state goes back to static')
  // The flip is noted on the item's key record, whose drawn bit the GPU verdict reads.
  const drawnBit = () => writeKeyRecords(blendState)[KEY_WORD.flags] & KEY_DRAWN
  assert.deepEqual(blendState.keyMoved, { from: 0, to: 0 }, 'its key record goes up')
  assert.equal(drawnBit(), 0, 'the frustum verdict keeps it out')
  assert.equal(
    writeKeyRecords(blendState)[KEY_RECORD_WORDS + KEY_WORD.flags] & KEY_DRAWN,
    KEY_DRAWN,
  )
  uploadWorlds(rt)
  assert.deepEqual(touched, [0], 'a revision that changes nothing tells nothing')
  group.visible = true
  uploadWorlds(rt)
  assert.deepEqual(parks, [
    [0, true],
    [0, false],
  ])
  assert.equal(item.hidden, false)
  assert.deepEqual(touched, [0, 0])
  assert.deepEqual(parkedMobility, [0], 'a root taken again keeps the static state')
  assert.deepEqual(blendState.keyMoved, { from: 0, to: 0 })
  assert.equal(drawnBit(), KEY_DRAWN)
  // #456: a node set to cast no shadow leaves every light cut.
  node.castShadow = false
  uploadWorlds(rt)
  assert.deepEqual(marks.slice(-1), [SHADOWLESS_ROOT])
  assert.deepEqual(changed, [])
  // A node that casts far shadows marks its root so, beside the shadowless bit.
  node.castFarShadow = true
  uploadWorlds(rt)
  assert.deepEqual(marks.slice(-1), [SHADOWLESS_ROOT | FAR_SHADOW_ROOT])
})
