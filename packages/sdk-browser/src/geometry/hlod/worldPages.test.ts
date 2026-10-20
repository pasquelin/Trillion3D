// A world page is a `WGP3` geometry page in world space, a slice of its bundle read as
// any page is (`worldRuns.ts`): read at its address from the cook's own fixture, every page is the
// cook's bytes, its world-space positions and its indices, no pose.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldPage } from './worldRootsPages.fixture.ts'
import { decodeGeometryPage } from '../codec/geometryPage.ts'
import { geometryPageAddress } from '../../../../sdk-core/src/page/contracts.ts'
import { opened, served } from './worldRoots.fixture.ts'

test('every page of the cooked world is read at its address as its own bytes, in world space', async (t) => {
  const { manifest, table } = served(t)
  const { queue } = await opened(t, manifest)
  assert.equal(table.pages.count, 6)
  for (let at = 0; at < table.pages.count; at++) {
    const { bundle, offset } = table.pages.at(at)
    const address = geometryPageAddress(
      'http://world/world-roots.bin',
      table.bundles[bundle].offset + offset,
    )
    const bytes = await queue.readBytes(address, queue.signal),
      x = at // the fixture's page `at` is the triangle at x = at
    assert.deepEqual([...bytes], [...worldPage(x).bytes], `page ${at}: the cook's bytes`)
    const decoded = decodeGeometryPage(bytes)
    assert.deepEqual([...decoded.attributes.position], [x, 0, 0, x + 1, 0, 0, x, 1, 0])
    assert.deepEqual([...decoded.indices], [0, 1, 2], 'no pose: the positions are world space')
  }
})
