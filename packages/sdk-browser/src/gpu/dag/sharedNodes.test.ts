// A primitive's culling nodes are packed once, shared by every placement of it: the node table
// does not grow with the placements, a queue entry names the placement beside the node, and the
// cut is the one each placement cut alone gives, page for page, whatever is resident. The open
// counts a resident page moves are the placement's own, kept in a table the view bounds
// (`heldOpen.ts`): an accelerator only — a table too small to hold them cuts the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { packDagSelection } from './pack.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { residentFlags } from './layout.fixture.ts'
import {
  CANDIDATES_START,
  QUEUE_ENTRIES_START,
  childBase,
  coldBase,
  residentBase,
  selectionListCap,
} from './layout.ts'
import { dagFlagShape, flagShapeWords } from './flagSections.ts'
import { CAND_LIVE_WORDS, LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { createDagResidencyUpload } from './residencyUpload.ts'
import { treeNodeCount } from './placementTree.ts'
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts'

const pages = scenePages(1024, 6)

/** `count` placements of one primitive on a grid, each turned a little. */
function field(count: number) {
  const side = Math.ceil(Math.sqrt(count))
  const roots = sceneRoots(
    pages,
    Array.from({ length: count }, (_, w) =>
      new G.Matrix4()
        .makeRotationY(w * 0.3)
        .setPosition((w % side) * 6 - 3 * side, 0, -Math.floor(w / side) * 6),
    ),
  )
  return roots
}

test('the node table holds each primitive once, from one placement to ten thousand', () => {
  const nodesOf = (packed: PackedDag) =>
    packed.nodes.byteLength / (DAG_NODE_FLOATS * 4) - treeNodeCount(packed.placementTree)
  const one = packDagSelection(field(1))
  for (const count of [1, 100, 10_000]) {
    const packed = packDagSelection(field(count))
    assert.equal(nodesOf(packed), nodesOf(one), `${count} placements: the primitive's nodes once`)
    // The tree above them is a node for some sixty placements at most.
    assert.ok(treeNodeCount(packed.placementTree) <= Math.ceil(count / 60) + 2, `${count}: tree`)
    assert.equal(packed.entryCount - treeNodeCount(packed.placementTree), count * nodesOf(one))
  }
})

/** The cut rule's residency the host uploads for `resident`, into `packed`, held table of `slots`
 *  slots: the bit sets the oracle reads. */
function residency(packed: PackedDag, resident: ArrayLike<number>, slots?: number) {
  const device = { queue: { writeBuffer() {} } } as unknown as GPUDevice
  const parts = { buffers: [{} as GPUBuffer], bytes: Number.MAX_SAFE_INTEGER }
  createDagResidencyUpload({ device, packed, coldParts: parts, heldSlots: slots })(resident)
  const bits = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset)
  return {
    ready: residentFlags(bits, packed.pageCount, residentBase(packed.pageCount)),
    childReady: residentFlags(bits, packed.pageCount, childBase(packed.pageCount)),
  }
}

/** The oracle's cut of `roots` packed together — or each placement packed alone, its pages put at
 *  its rank — under `camera`, `resident` per page. */
function cut(
  roots: DagRoot[],
  camera: ReturnType<typeof G.perspectiveCamera>,
  resident: Uint8Array,
  alone = false,
) {
  const uniforms = cameraSelectionUniforms(engineCamera(camera), 1, [1280, 720])
  const of = (group: DagRoot[], first: number, slots?: number) => {
    const packed = packedWorldsToRenderOrigin(packDagSelection(group), group, uniforms.cameraWorld)
    const held = residency(packed, resident.subarray(first, first + packed.pageCount), slots)
    const result = evaluateDagSelectionKernel(packed, uniforms, held)
    const shift = (ids: readonly number[] | undefined) => (ids ?? []).map((id) => id + first)
    return { wanted: shift(result.pageIds), drawn: shift(result.drawablePageIds) }
  }
  const parts = alone ? roots.map((root, w) => of([root], w * pages.length)) : [of(roots, 0)]
  const sorted = (key: 'wanted' | 'drawn') => parts.flatMap((p) => p[key]).sort((a, b) => a - b)
  return { wanted: sorted('wanted'), drawn: sorted('drawn'), of }
}

test('the cut over shared nodes is each placement cut alone, page for page, residency or not', () => {
  const roots = field(9)
  const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 400)
  let drawn = 0
  for (const [x, z] of [
    [0, 12],
    [-9, 4],
    [6, -20],
  ]) {
    camera.position.set(x, 3, z)
    camera.lookAt(0, 0, -6)
    camera.updateMatrixWorld()
    for (const keep of [7, 3, 1]) {
      const resident = Uint8Array.from({ length: roots.length * pages.length }, (_, i) =>
        i % keep === 0 || pages[i % pages.length].parentError == null ? 1 : 0,
      )
      const shared = cut(roots, camera, resident),
        alone = cut(roots, camera, resident, true)
      assert.deepEqual(shared.wanted, alone.wanted, `(${x}, ${z}), 1 in ${keep}: wanted`)
      assert.deepEqual(shared.drawn, alone.drawn, `(${x}, ${z}), 1 in ${keep}: drawn`)
      // A held table of two slots keeps almost no count of its own: the cut is the same.
      const tight = shared.of(roots, 0, 2)
      assert.deepEqual(
        tight.drawn.sort((a, b) => a - b),
        shared.drawn,
        'a table too small',
      )
      drawn += shared.drawn.length
    }
  }
  assert.ok(drawn > 0, 'no page drawn: the proof covers nothing')
})

test('the cold table holds no word per page: residency bits, then what each record and key holds', () => {
  const one = packDagSelection(field(1))
  for (const count of [100, 1000]) {
    const packed = packDagSelection(field(count))
    // What the placements past the first add: their pages' residency bits, a tree slot each, and
    // the pool's list, as long as the readout's cap (`selectionListCap`), the view's bound.
    const pool = 4 * (selectionListCap(packed.pageCount) - selectionListCap(one.pageCount))
    const bytes = packed.pageCones.byteLength - one.pageCones.byteLength - pool,
      pages = packed.pageCount - one.pageCount
    assert.ok(bytes / pages < 1, `${count} placements: ${bytes / pages} bytes a page`)
    assert.ok(coldBase(packed) - coldBase(one) <= Math.ceil(pages / 16) + 2 + pool / 4, `${count}`)
  }
})

test('a cut’s flags hold a view’s reach, its queues and lists, never a word per placement or page', () => {
  const one = packDagSelection(field(1))
  // Each queue's entries, each list's, as a cut starts; the last uses, a word a content key.
  const bound =
    LEVEL_QUEUES * 2 * QUEUE_ENTRIES_START + CAND_LIVE_WORDS * CANDIDATES_START + one.keyCount
  for (const count of [100, 10_000]) {
    const packed = packDagSelection(field(count)),
      shape = dagFlagShape(packed)
    assert.equal(shape.keyCount, one.keyCount, `${count} placements: the keys are the primitive's`)
    assert.ok(flagShapeWords(shape) <= bound, `${count} placements: within the reach`)
  }
})

test('the packing holds no host table of a word per page: a page names its placement by the index', () => {
  const packed = packDagSelection(field(1000))
  for (const [name, value] of Object.entries(packed))
    if (ArrayBuffer.isView(value) && name !== 'pageCones')
      assert.ok(value.byteLength < packed.pageCount, `${name}: ${value.byteLength} B`)
  // The cold table is the GPU's: its residency bits, a bit a page, and its records'.
  assert.ok(packed.pageCones.byteLength < packed.pageCount, 'pageCones')
  assert.equal(packed.pageIndex.baseOfRoot.length, packed.worldCount)
})
