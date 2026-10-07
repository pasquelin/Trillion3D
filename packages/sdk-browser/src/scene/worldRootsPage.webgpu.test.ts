// Every world super-root page of the cooked fixture, read at its world address, lands in a GPU
// page slot whole: a geometry page, decoded in place by the shaders as any page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { fakeDevice, replayWrites } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPageCache } from '../gpu/page/pages.ts'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts'
import { worldRootsPageAddress } from './worldPageServe.ts'

test('every page lands in a WebGPU page slot as cooked', async () => {
  installGpuGlobals()
  const { table, source } = worldRootsPageFixtureSource()
  assert.equal(table.pages.count, 4)
  for (let at = 0; at < table.pages.count; at++) {
    const { bundle, offset, bytes } = table.pages.at(at)
    const address = worldRootsPageAddress(table.payload.url, bundle, offset),
      cooked = worldPage(bundle).bytes, // the fixture's page `bundle` is the triangle at x = bundle
      pageBytes = Math.ceil(bytes / 4) * 4
    const gpu = fakeDevice({ limits: { maxBufferSize: 1024 } }),
      cache = createGpuPageCache(gpu.device, source, { pageBytes, slots: 1 }),
      resident = await cache.load(address)
    assert.equal(resident.bytes, bytes, `page ${bundle}: its bytes in the slot`)
    const slot = new Uint8Array(pageBytes)
    replayWrites(slot.buffer, gpu.writes)
    assert.deepEqual([...slot.subarray(0, bytes)], [...cooked], `page ${bundle}: the cook's page`)
  }
})
