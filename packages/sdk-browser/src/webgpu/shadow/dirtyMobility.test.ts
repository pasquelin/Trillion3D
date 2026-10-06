// The mobility words follow the table's dirty runs, not its span (#831): two models moving at both
// ends of the table write their own rows, and the GPU holds, word for word, what the span wrote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadDirtyRowMobility, uploadRowMobility } from './bounds.ts'
import { createShadowMobility } from './mobility.ts'
import { createWebgpuRowState } from '../row/state.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { ROW_INDEX_WORDS } from '../row/pageRow.ts'
import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../gpu/shadow/mobilityBits.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { fakeDevice, replayWrites } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const ROWS = 1000,
  PLACEMENTS = 8

/** A table of `ROWS` rows over `PLACEMENTS` placements, and the bytes its mobility buffer holds. */
function twin() {
  const pages = Array.from({ length: ROWS }, (_, i) => ({ url: `p${i}` }) as unknown as PageRec)
  const rows = createWebgpuRowState(pages, ROWS)
  rows.pageTableInts = new Uint32Array((ROWS * PAGE_INFO_STRIDE) / 4)
  for (let row = 0; row < ROWS; row++) {
    rows.packedPageIndex[row] = row
    rows.packedRecs[row] = pages[row]
  }
  rows.packedCount = ROWS
  const roots = Array.from({ length: PLACEMENTS }, () => ({
    world: { elements: new Float64Array(16) },
  }))
  const { device, writes } = fakeDevice()
  const rt = {
    layout: {
      rows,
      selectionRoots: roots,
      placement: { rootOfPacked: Int32Array.from({ length: ROWS }, (_, p) => p % PLACEMENTS) },
    },
    lights: { mobility: createShadowMobility() },
    setup: { maxCorners: 96 },
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  const bytes = new ArrayBuffer(ROWS * 4)
  let sent = 0
  const held = () => {
    sent = writes.reduce((sum, { size }) => sum + size!, 0)
    replayWrites(bytes, writes)
    return [...new Uint32Array(bytes)]
  }
  return { rt, rows, roots, held, sent: () => sent }
}

test('the mobility words of a scattered change are its runs, and the words the span wrote', () => {
  const span = twin(),
    runs = twin()
  const sides = [span, runs]
  // The span's path, then the runs' path; each table's marks then consumed, as the image does.
  const upload = () => {
    uploadRowMobility(span.rt, span.rt.gpu.device!, span.rows.dirtyFrom, span.rows.dirtyTo)
    uploadDirtyRowMobility(runs.rt, runs.rt.gpu.device!)
    for (const { rows } of sides) rows.clearDirty()
  }
  upload()
  assert.deepEqual(runs.held(), span.held(), 'a new table: every row, alike')
  // Rows at both ends given another corner count, one placement turned moving, one
  // row given to another placement, a placement parked: what one image of the scene changes.
  for (const { rt, rows, roots } of sides) {
    const ints = rows.pageTableInts!
    for (const row of [2, 3, 997]) {
      ints[row * (PAGE_INFO_STRIDE / 4) + ROW_INDEX_WORDS] = 3 * row
      rows.markRowWords(row)
    }
    rt.layout.placement.rootOfPacked[500] = 3
    rows.markRowWords(500)
    rt.lights.mobility.move(3, roots[3].world.elements, true)
    ;(roots[5] as { parked?: boolean }).parked = true
    rt.lights.mobility.touch(5)
  }
  const before = runs.held()
  upload()
  const after = runs.held()
  assert.deepEqual(after, span.held(), 'the same words on the GPU, word for word')
  assert.ok(span.sent() >= 995, 'the span sent every row from 2 to 997')
  assert.ok(
    runs.sent() < 400,
    `the runs sent their rows and the touched placements': ${runs.sent()}`,
  )
  assert.notDeepEqual(after, before, 'and the change reached it')
  // A still image: neither path writes a word.
  upload()
  assert.deepEqual(runs.held(), span.held())
})

test('the words after a sequence of dirty runs are the rows own, from closures built once', () => {
  const { rt, rows, roots, held } = twin(),
    { mobility } = rt.lights
  const ensure = mobility.ensure,
    writeRows = mobility.writeRows
  const ensured: Array<Parameters<typeof ensure>[2]> = [],
    written: Array<Parameters<typeof writeRows>> = []
  mobility.ensure = (...args) => (ensured.push(args[2]), ensure(...args))
  mobility.writeRows = (...args) => (written.push(args), writeRows(...args))
  const ints = rows.pageTableInts!,
    words = PAGE_INFO_STRIDE / 4
  const upload = () => {
    uploadDirtyRowMobility(rt, rt.gpu.device!)
    rows.clearDirty()
  }
  const moved = new Set<number>(),
    parked = new Set<number>()
  upload() // a new table: the state is sized, the placements can move
  // Each image marks rows at both ends of the table and in its middle: several runs to write.
  for (let image = 1; image <= 4; image++) {
    for (const row of [image, image + 1, 400 + image, 990 - image]) {
      ints[row * words + ROW_INDEX_WORDS] = 7 * row + image
      rows.markRowWords(row)
    }
    rt.layout.placement.rootOfPacked[500 + image] = image
    rows.markRowWords(500 + image)
    mobility.move(image, roots[image].world.elements, true)
    moved.add(image)
    if (image % 2) {
      ;(roots[image + 3] as { parked?: boolean }).parked = true
      mobility.touch(image + 3)
      parked.add(image + 3)
    }
    upload()
    const placementOf = (row: number) => rt.layout.placement.rootOfPacked[row]
    const expected = Array.from(
      { length: ROWS },
      (_, row) =>
        (ints[row * words + ROW_INDEX_WORDS] << MOBILITY_CORNER_SHIFT) |
        (moved.has(placementOf(row)) ? MOBILITY_MOVING : 0) |
        (parked.has(placementOf(row)) ? MOBILITY_SHADOWLESS : 0),
    )
    assert.deepEqual(held(), expected, `image ${image}: every row holds the words its state gives`)
  }
  uploadRowMobility(rt, rt.gpu.device!, 0, -1)
  // One call to start each image, then one per run: far more calls than images, one set of closures.
  assert.ok(written.length >= 4 * 3, `runs were written: ${written.length}`)
  for (const at of [0, 4, 5, 7, 8]) {
    assert.equal(new Set(written.map((args) => args[at])).size, 1, `argument ${at} of writeRows`)
  }
  assert.equal(new Set(ensured).size, 1, 'the world reader handed to ensure')
})
