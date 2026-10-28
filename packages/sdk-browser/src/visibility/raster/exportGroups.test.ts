import test from 'node:test'
import assert from 'node:assert/strict'
import { rasterOf } from './rasterFrame.fixture.ts'

// The export's layouts and the groups bound to them hold the same number of entries, whichever
// device: a group of fewer or more entries than its layout is refused by the device at creation.
for (const wide of [false, true])
  test(`every bind group the raster frame makes holds the entries of its layout, ${wide ? 'with' : 'without'} the 64-bit word`, async () => {
    const { f, device, frame } = rasterOf(false, false, wide)
    // The export's groups are made at the first close of an image and kept while their resources hold:
    // the groups of that first frame are the ones to read, none cleared before.
    frame()
    await new Promise((done) => setTimeout(done, 0))
    assert.ok(f.bindGroups.length > 0, 'the frame bound groups')
    // The export's own group: the buffer, the view's uniform, level 0, the identifiers, the pages, the bins, the masks.
    const exported = f.bindGroups.filter((group) => [...group.entries].some((e) => e.binding === 8))
    assert.ok(exported.length > 0, 'the closed image bound the export group')
    for (const group of f.bindGroups) {
      const layout = group.layout as unknown as { entries?: Iterable<unknown>; label?: string }
      const expected = [...(layout.entries ?? [])].length
      assert.equal(
        [...group.entries].length,
        expected,
        `${group.label ?? layout.label ?? 'a group'}`,
      )
    }
    assert.ok(device)
  })
