// A growth in place appends its new placements into the room the cut's packing kept (`pack.ts`):
// the tables then read word for word as a packing of every root at that capacity, and the GPU cut
// over them selects what a cut made over every root selects. Past the room, or for a primitive the
// packing does not hold, nothing is appended: the caller packs every root again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { packDagSelection } from './pack.ts'
import { appendDagRoots } from './packAppend.ts'
import { scene, TABLES } from './packAppend.fixture.ts'
import { dagRootCounts } from './packCapacity.ts'
import { placementField } from '../placement/placementTree.fixture.ts'
import { scenePages, sceneRoots } from '../cut/cutFrontierScene.fixture.ts'
import { createGpuDagSelection } from '../selection/selection.ts'
import { mockDagDevice } from '../selection/selection.fixture.ts'
import { followNoResidency, kernelUniforms } from '../selection/selectionHelpers.fixture.ts'
import { frontCamera } from '../../selection/dag.fixture.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { hostStretches } from '../hostStretches.fixture.ts'
import { DRAW_DISTANCE_MARK, DRAW_INSTANCE_MARK, ROOT_PARENT_MARK } from '../frameTable.ts'
import { NODE_KIND, NODE_PARENT, PARENT_ERROR, PARENT_SPHERE } from '../nodeLayout.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

test('roots appended into the room read as a packing of every root at that capacity', () => {
  const { roots, counts, capacity } = scene()
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  const added = appendDagRoots(grown, roots.slice(2))
  const per = counts.pages / roots.length,
    nodes = counts.nodes / roots.length
  // No node appended: every placement reads its primitive's, packed once.
  assert.deepEqual(added, {
    pages: [2 * per, counts.pages],
    worlds: [2, 5],
    nodes: [nodes, nodes],
    records: [per, per],
    tree: { nodes: new Int32Array(0), members: [0, 0] },
  })
  for (const table of TABLES) assert.deepEqual(grown[table], whole[table], table)
  assert.deepEqual(grown.live, whole.live)
  // One cluster record's set for the one page array the placements share.
  assert.deepEqual(grown.live, {
    ...{ pages: counts.pages, nodes, worlds: 5, entries: counts.nodes },
    infos: per,
  })
  const sizes = ({
    pageCount,
    nodeCount,
    entryCount,
    worldCount,
    recordCount,
    rootCount,
  }: typeof whole) => [pageCount, nodeCount, entryCount, worldCount, recordCount, rootCount]
  assert.deepEqual(sizes(grown), sizes(whole))
  assert.deepEqual(grown.cutLinks, whole.cutLinks)
  for (let page = 0; page < capacity.pages; page++)
    assert.equal(grown.pageUrlOf(page), whole.pageUrlOf(page), `page ${page}`)
  assert.equal(grown.pageUrlOf(counts.pages), undefined, 'the room names no page')
})

test('the distances a root names are packed with its placement, appended in place as packed whole', () => {
  const { roots, capacity } = scene()
  roots[1].drawDistance = { min: 5, max: 40, perInstance: false }
  roots[3].drawDistance = { min: 0, max: 250.5, perInstance: true }
  roots[4].drawDistance = { min: 3, max: 0, perInstance: false }
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  appendDagRoots(grown, roots.slice(2))
  // Three floats a placement, the nearest, the farthest and 1 for an instance, 0 for none, a slot
  // of the room included.
  const named = new Float32Array(3 * 8)
  named.set([5, 40, 0], 3)
  named.set([0, 250.5, 1], 9)
  named.set([3, 0, 0], 12)
  assert.deepEqual(whole.drawDistance, named)
  assert.deepEqual(grown.drawDistance, named)
  // The mark says which name one, and which of them is an instance.
  for (const packed of [whole, grown])
    assert.deepEqual(
      Array.from(packed.mark.subarray(0, 5), (mark) => [
        (mark & DRAW_DISTANCE_MARK) !== 0,
        (mark & DRAW_INSTANCE_MARK) !== 0,
      ]),
      [
        [false, false],
        [true, false],
        [false, false],
        [true, true],
        [true, false],
      ],
    )
})

test('the group above the root of an instance of an assembly is a node, shared by the placements that read it, packed with its placement and appended in place as packed whole', () => {
  const { roots, counts, capacity } = scene()
  const room = { ...capacity, ahead: true },
    per = counts.nodes / roots.length
  const group = { error: 6.5, sphere: [1.25, -2, 3, 40] } as const
  roots[1].rootParent = group
  roots[3].rootParent = { error: 0.5, sphere: [0, 0, 0, 9] }
  roots[4].rootParent = { ...group }
  const whole = packDagSelection(roots, room),
    grown = packDagSelection(roots.slice(0, 2), room)
  const added = appendDagRoots(grown, roots.slice(2))
  // One node a distinct group, behind the primitive's: the placements of the same group share it,
  // a placement that names none holds none, and the mark bit says which name one.
  const named = [NO_INDEX, per, NO_INDEX, per + 1, per]
  assert.deepEqual(added?.nodes, [per + 1, per + 2], 'the second group, appended behind the first')
  for (const packed of [whole, grown]) {
    assert.deepEqual(Array.from(packed.parentNode!.subarray(0, 5)), named)
    assert.deepEqual(
      Array.from(packed.mark.subarray(0, 5), (mark) => (mark & ROOT_PARENT_MARK) !== 0),
      [false, true, false, true, true],
    )
    assert.equal(packed.live!.nodes, per + 2)
    const words = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset)
    for (const [node, error, ball] of [
      [per, 6.5, [1.25, -2, 3, 40]],
      [per + 1, 0.5, [0, 0, 0, 9]],
    ] as const) {
      const at = node * DAG_NODE_FLOATS
      assert.equal(packed.nodes[at + PARENT_ERROR], error)
      assert.deepEqual(
        Array.from(packed.nodes.subarray(at + PARENT_SPHERE, at + PARENT_SPHERE + 4)),
        ball,
      )
      assert.equal(words[at + NODE_KIND], NODE_PARENT, 'a node no descent reaches')
    }
  }
  assert.equal(packDagSelection(scene().roots, capacity).parentNode, undefined, 'none names one')
  // A packing exactly the roots' holds a node for each of their groups, and no room for another.
  const exact = packDagSelection(roots)
  assert.equal(exact.primitiveNodeCount, per + 2)
  assert.equal(exact.parentNode![3], per + 1)
})

test('a growth’s room keeps a node for every placement it takes once the roots name a group, none before', () => {
  const { roots, capacity } = scene()
  const nodes = (worlds: number) =>
    packDagSelection(roots, { ...capacity, worlds, ahead: true }).primitiveNodeCount
  assert.equal(nodes(200) - nodes(100), 0, 'no group named: the primitives’ room alone')
  roots[1].rootParent = { error: 6.5, sphere: [1.25, -2, 3, 40] }
  assert.equal(nodes(200) - nodes(100), 100, 'a node for each placement the room takes')
  const exact = packDagSelection(roots, { ...capacity, worlds: 200 })
  assert.equal(exact.primitiveNodeCount, exact.live!.nodes, 'a room that is no growth’s keeps none')
})

test('roots that name a group are not appended into a packing whose tree holds no ball, wide ones are', () => {
  const roots = placementField(40, 6),
    counts = dagRootCounts(roots)
  const room = {
    ...{ pages: 2 * counts.pages, nodes: 2 * counts.nodes },
    ...{ worlds: roots.length + 8, ahead: true },
  }
  const narrow = packDagSelection(roots, room)
  assert.ok(narrow.placementTree, 'a tree over the placements')
  assert.equal(narrow.parentNode, undefined, 'its packing names no group')
  const named = { ...roots[0], rootParent: { error: 2, sphere: [0, 0, 0, 4] as const } }
  assert.equal(appendDagRoots(narrow, [named]), undefined, 'packed again, wide')
  assert.equal(narrow.parentNode, undefined, 'nothing was made in place')
  assert.ok(appendDagRoots(narrow, [roots[0]]), 'a placement that names none is appended')
  roots[3].rootParent = { error: 1, sphere: [0, 0, 0, 2] }
  const wide = packDagSelection(roots, room)
  assert.ok(appendDagRoots(wide, [named]), 'the packing that names groups takes one more')
  assert.equal(wide.live!.worlds, roots.length + 1)
})

test('roots past the room, or of a primitive the packing does not hold, are not appended', () => {
  const { roots, capacity } = scene()
  const tight = packDagSelection(roots.slice(0, 2), { ...capacity, worlds: 3 })
  assert.equal(appendDagRoots(tight, roots.slice(2)), undefined, 'two placements too many')
  const other = sceneRoots(scenePages(64, 3), [new Matrix4()])
  assert.equal(appendDagRoots(tight, other), undefined, 'a primitive it does not hold')
  assert.deepEqual(tight.live, packDagSelection(roots.slice(0, 2)).live, 'nothing moved')
})

test('a packing without a capacity is the exact one and keeps no room', () => {
  const { roots, counts } = scene()
  const exact = packDagSelection(roots)
  // One primitive: its nodes once, an entry for each of them a placement.
  assert.deepEqual(
    [exact.pageCount, exact.nodeCount, exact.entryCount, exact.worldCount],
    [counts.pages, counts.nodes / roots.length, counts.nodes, roots.length],
  )
  assert.equal(exact.shared, undefined)
  assert.equal(appendDagRoots(exact, roots.slice(0, 1)), undefined)
})

test('the GPU cut over the roots appended in place selects what a cut over every root does', async () => {
  installGpuGlobals()
  const { roots, capacity } = scene()
  const cutOf = async (packed: ReturnType<typeof packDagSelection>) => {
    const selection = await createGpuDagSelection(mockDagDevice(packed).device, packed, {
      roots: hostStretches(packed),
    })
    assert.ok(selection)
    followNoResidency(packed)
    return selection
  }
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  // The render frame set before the reference is made: its worlds go up rebased. From 20 units
  // the view holds the five placements, appended ones included, and a 1 px cut stops on them: the
  // finest pages' own error (0.01) is under a pixel there — from 5 units it is past one at every
  // level, and no page is cut at all.
  const uniforms = kernelUniforms(whole, roots, frontCamera(20), 1)
  const [reference, appended] = [await cutOf(whole), await cutOf(grown)]
  const held = grown.live!.pages
  assert.equal(appended.pageCount, held, 'the pages its roots hold')
  assert.equal(appended.appendRoots(roots.slice(2)), true)
  assert.equal(appended.pageCount, whole.live!.pages)
  // The same worlds, one placement each, as the session sends them every image: the append sent
  // them already, nothing moves.
  assert.equal(appended.updateWorlds(whole.worlds.slice()).length, 0)
  const results = []
  for (const selection of [reference, appended]) {
    selection.dispatch(uniforms)
    results.push((await selection.flush())?.pageIds.slice().sort((a, b) => a - b))
  }
  assert.ok(results[0]!.length > 0, 'the view asks pages')
  assert.deepEqual(results[1], results[0])
  assert.ok(
    results[1]!.some((page) => page >= held),
    'the placements appended are cut too',
  )
  reference.dispose()
  appended.dispose()
})

test('roots appended under a still eye are brought to it before the next cut', async () => {
  installGpuGlobals()
  const { roots, capacity } = scene()
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  const uniforms = kernelUniforms(whole, roots, frontCamera(20), 1)
  const cut = async (packed: ReturnType<typeof packDagSelection>, append = false) => {
    const selection = (await createGpuDagSelection(mockDagDevice(packed).device, packed, {
      roots: hostStretches(packed),
    }))!
    followNoResidency(packed)
    selection.dispatch(uniforms)
    await selection.flush()
    // The eye has not moved: the cut reads the worlds the append wrote at it.
    if (append) assert.equal(selection.appendRoots(roots.slice(2)), true)
    selection.dispatch(uniforms)
    const pages = (await selection.flush())?.pageIds.slice().sort((a, b) => a - b)
    selection.dispose()
    return pages
  }
  const [reference, appended] = [await cut(whole), await cut(grown, true)]
  assert.ok(reference!.length > 0)
  assert.deepEqual(appended, reference)
})
