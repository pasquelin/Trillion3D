// Every world page of the cooked fixture, read at its address, lands in a GPU page slot
// whole: a geometry page, decoded in place by the shaders as any page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createGpuPageCache } from '../pages/pool/pages.ts'
import { worldPage } from './worldRootsPages.fixture.ts'
import { opened, served } from './worldRoots.fixture.ts'
import { geometryPageAddress } from '../../../../sdk-core/src/page/contracts.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'

test('every page lands in a WebGPU page slot as cooked', async (t) => {
  installGpuGlobals()
  const { manifest, table } = served(t)
  const { queue } = await opened(t, manifest)
  const source = {
    read: (key: string, signal?: AbortSignal) => queue.readBytes(key, signal ?? queue.signal),
  }
  assert.equal(table.pages.count, 6)
  for (let at = 0; at < table.pages.count; at++) {
    const { bundle, offset, bytes } = table.pages.at(at)
    const address = geometryPageAddress(
        'http://world/world-roots.bin',
        table.bundles[bundle].offset + offset,
      ),
      cooked = worldPage(at).bytes, // the fixture's page `at` is the triangle at x = at
      pageBytes = alignUp(bytes, 4)
    const gpu = fakeDevice({ limits: { maxBufferSize: 1024 } }),
      cache = createGpuPageCache(gpu.device, source, { pageBytes, slots: 1 }),
      resident = await cache.load(address)
    assert.equal(resident.bytes, bytes, `page ${at}: its bytes in the slot`)
    // The page on disk goes to the install pass's staging whole; the pass transcodes it into its slot.
    const staging = gpu.writes.find(
      ({ buffer }) => buffer.label === 'Trillion3D page install staging',
    )
    assert.ok(staging, `page ${at}: staged`)
    assert.deepEqual(
      [...writtenBytes(staging).subarray(0, bytes)],
      [...cooked],
      `page ${at}: the cook's page`,
    )
  }
})
