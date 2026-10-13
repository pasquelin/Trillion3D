import '../../wasm/sdkWasm.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { answering, refusedWith } from '../../cluster/answers.fixture.ts'
import { encodePage } from '../../page/codec/encodePage.fixture.ts'
import { createGpuPageCache } from '../../gpu/page/pages.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import { sha256Hex } from '../../streaming/sha256Hex.ts'
import { page } from './index.ts'

const BASE = 'https://cache.test/model/pages/'
const { device } = fakeDevice({ limits: { maxBufferSize: 4096 } })
const POOL = { pageBytes: 512, slots: 1 }

/** One triangle's geometry page, as the compiler writes it. */
const geometry = encodePage([0, 1, 2], {
  POSITION: { itemSize: 3, array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
}).data

/** The catalogue of one page, `p0.bin`, announcing the size and fingerprint of `bytes`. */
const listed = async (bytes: Uint8Array<ArrayBuffer>) => [
  { url: 'p0.bin', bytes: bytes.byteLength, sha256: await sha256Hex(bytes) },
]

/** Whether `error` is the streamer's refusal of a read the server refused with `status`. */
const failedWith = (status: number) => (error: unknown) =>
  error instanceof Error &&
  /PAGE_STREAM_FAILED/.test(error.message) &&
  refusedWith(status, 'p0.bin')(error.cause)

test('a page the server does not hold (404) is refused by its address, never asked again', async (t) => {
  const asked = answering(t, 'p0.bin', [404])
  const source = page.httpSource(BASE, { pages: await listed(geometry), cache: createPageCache() })
  const cache = createGpuPageCache(device, source, POOL)
  // Another request would meet the same refusal.
  await assert.rejects(cache.load('p0.bin'), failedWith(404))
  await assert.rejects(cache.load('p0.bin'), /PAGE_STREAM_FAILED/)
  assert.equal(asked.length, 1)
  await cache.dispose()
  source.dispose()
})

test('a page its announced size and fingerprint pass but the geometry format refuses never reaches the pool', async (t) => {
  // Twelve bytes the catalogue announces exactly: the streamer's check passes them, the format's
  // gate does not.
  const forged = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0])
  answering(t, 'p0.bin', [200], () => forged)
  const source = page.httpSource(BASE, { pages: await listed(forged), cache: createPageCache() })
  const cache = createGpuPageCache(device, source, POOL)
  await assert.rejects(cache.load('p0.bin'), /GEOMETRY_PAGE_/)
  assert.equal(cache.get('p0.bin'), undefined, 'never uploaded')
  await cache.dispose()
  source.dispose()
})

test('two GPU loads of one page in flight join its one read: one request, one resident page', async (t) => {
  const asked = answering(t, 'p0.bin', [200], () => geometry)
  const source = page.httpSource(BASE, { pages: await listed(geometry), cache: createPageCache() })
  const cache = createGpuPageCache(device, source, POOL)
  const [first, second] = await Promise.all([cache.load('p0.bin'), cache.load('p0.bin')])
  assert.deepEqual([second, asked.length], [first, 1])
  assert.equal(first.bytes, geometry.byteLength)
  await cache.dispose()
  source.dispose()
})

test('sources over one host cache share its pages: a page one read is not fetched again', async (t) => {
  const asked = answering(t, 'p0.bin', [200], () => geometry)
  const shared = createPageCache()
  const pages = await listed(geometry)
  const first = page.httpSource(BASE, { pages, cache: shared })
  assert.deepEqual(Array.from(await first.read('p0.bin')), Array.from(geometry))
  first.dispose()
  const second = page.httpSource(BASE, { pages, cache: shared })
  assert.deepEqual(Array.from(await second.read('p0.bin')), Array.from(geometry))
  assert.equal(asked.length, 1, 'the second read is the host cache’s')
  assert.equal(shared.pageCount, 1)
  second.dispose()
})

test('a page the catalogue does not list is refused without a request', async (t) => {
  const asked = answering(t, 'p1.bin', [200], () => geometry)
  const source = page.httpSource(BASE, { pages: await listed(geometry), cache: createPageCache() })
  await assert.rejects(source.read('p1.bin'), /Unknown page/)
  assert.equal(asked.length, 0)
  source.dispose()
})

test('dispose cancels the reads in flight', async (t) => {
  answering(t, 'p0.bin', ['hang'])
  const source = page.httpSource(BASE, { pages: await listed(geometry), cache: createPageCache() })
  const reading = source.read('p0.bin')
  source.dispose()
  await assert.rejects(reading, { name: 'AbortError' })
})
