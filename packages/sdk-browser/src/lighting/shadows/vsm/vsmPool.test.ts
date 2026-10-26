// The set drawn within a byte budget (`vsmPoolWithin`): the most physical pages among the asked
// count and its halves to an eighth whose every buffer fits, what `createVsmResources` then asks
// the device for.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { vsmLayout, type VsmResourceOptions } from './layout.ts'
import { vsmPoolPagesBound, vsmResourceBytes } from './layoutBytes.ts'
import { vsmPoolWithin } from './poolDraw.ts'

/** The engine's one-sun set (`engineVsmOptions`): two page-table rows, the mask for two suns. */
const SUN: VsmResourceOptions = { fullMapCapacity: 127, sunMapCapacity: 35 }
const bytesAt = (poolPages: number) => vsmResourceBytes(vsmLayout({ ...SUN, poolPages }))
const pagesWithin = (budget: number, options = SUN) =>
  vsmPoolWithin(budget, options)?.layout.poolPages

test('the whole pool when its bytes fit, the next half one byte short of each', () => {
  assert.equal(pagesWithin(bytesAt(4096)), 4096)
  assert.equal(pagesWithin(bytesAt(4096) - 1), 2048)
  assert.equal(pagesWithin(bytesAt(2048)), 2048)
  assert.equal(pagesWithin(bytesAt(2048) - 1), 1024)
  assert.equal(pagesWithin(bytesAt(1024) - 1), 512)
  assert.equal(pagesWithin(bytesAt(512) - 1), undefined, 'below the eighth: no pool')
  assert.equal(pagesWithin(Infinity), 4096, 'an unbounded budget is the full pool')
})

test('the pool drawn says why it is short, and holds what the device is asked for', () => {
  for (const [budget, clamp] of [
    [bytesAt(4096), null],
    [bytesAt(4096) - 1, 'ceiling'],
    [bytesAt(512), 'minimum'],
  ] as const) {
    const pool = vsmPoolWithin(budget, SUN)!
    assert.equal(pool.clamp, clamp)
    assert.equal(pool.budgetBytes, budget)
    const fake = fakeDevice()
    const res = createVsmResources(fake.device, {
      ...SUN,
      poolPages: pool.layout.poolPages,
    })
    assert.equal(pool.allocatedBytes, res.bytes)
    assert.equal(res.bytes, vsmResourceBytes(res.layout))
    assert.deepEqual(res.layout, pool.layout)
  }
})

test('a pool asked at fewer pages never grows past them', () => {
  const kept = { ...SUN, poolPages: 1024 }
  assert.equal(pagesWithin(Infinity, kept), 1024)
  assert.equal(pagesWithin(bytesAt(1024) - 1, kept), 512)
  assert.equal(pagesWithin(bytesAt(128) + 1, kept), 128, 'its eighth')
  assert.equal(pagesWithin(bytesAt(128) - 1, kept), undefined)
})

test('a pool is two slices, one buffer each: 8192 pages 512 MiB, 4096 256 MiB, 2048 128 MiB', () => {
  for (const [pages, slice] of [
    [8192, 536_870_912],
    [4096, 268_435_456],
    [2048, 134_217_728],
    [1024, 67_108_864],
  ]) {
    const fake = fakeDevice()
    createVsmResources(fake.device, { ...SUN, poolPages: pages })
    for (const label of ['vsm.physicalPool0', 'vsm.physicalPool1'])
      assert.equal(fake.buffers.find((b) => b.label === label)?.size, slice, `${pages}: ${label}`)
  }
})

test('a device holds in one binding the pages its binding and buffer limits allow, a power of two', () => {
  const MIB = 2 ** 20
  const pages = (binding: number, buffer: number) =>
    vsmPoolPagesBound({ maxStorageBufferBindingSize: binding, maxBufferSize: buffer })
  assert.equal(pages(128 * MIB, 256 * MIB), 2048, 'the defaults: the 2048-page pool')
  assert.equal(pages(256 * MIB, 256 * MIB), 4096)
  assert.equal(pages(4096 * MIB, 4096 * MIB), 65536, 'what the adapter offers: past the most')
  assert.equal(pages(4096 * MIB, 300 * MIB), 4096, 'the buffer holds less than the binding')
  assert.equal(pages(500 * MIB, 4096 * MIB), 4096, 'rounded down to a power of two')
  assert.ok(pages(512 * MIB, 512 * MIB) >= 8192, 'the highest level (8192 pages) fits 512 MiB')
})
