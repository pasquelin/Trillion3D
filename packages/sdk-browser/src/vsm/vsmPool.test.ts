// The set drawn within a byte budget (`vsmPoolWithin`): the most physical pages among the asked
// count and its halves to an eighth whose every buffer fits, what `createVsmResources` then asks
// the device for; and the transmission atlas's bytes, what the device ledger counts of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts'
import { createVsmResources } from './resources.ts'
import { createVsmTransmission } from './transmissionMade.ts'
import { vsmLayout, type VsmResourceOptions } from './layout.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import { vsmDemandPages, vsmPoolWithin, vsmViewPoolPages } from './poolDraw.ts'
import { VSM_POOL_PAGES } from './constants.ts'
import { vsmTransmissionBytes, vsmTransmissionFirstCaps } from './transmissionLayout.ts'

const BINDING = 1 << 27
/** The engine's one-sun set (`engineVsmOptions`): two page-table rows, the mask for two suns. */
const SUN: VsmResourceOptions = { fullMapCapacity: 127, sunMapCapacity: 35 }
const bytesAt = (poolPages: number) => vsmResourceBytes(vsmLayout({ ...SUN, poolPages }))
const pagesWithin = (budget: number, options = SUN) =>
  vsmPoolWithin(budget, options)?.layout.poolPages

test('the whole pool when its bytes fit, the next half one byte short of each', () => {
  assert.equal(pagesWithin(bytesAt(2048)), 2048)
  assert.equal(pagesWithin(bytesAt(2048) - 1), 1024)
  assert.equal(pagesWithin(bytesAt(1024)), 1024)
  assert.equal(pagesWithin(bytesAt(1024) - 1), 512)
  assert.equal(pagesWithin(bytesAt(512) - 1), 256)
  assert.equal(pagesWithin(bytesAt(256) - 1), undefined, 'below the eighth: no pool')
  assert.equal(pagesWithin(Infinity), 2048, 'an unbounded budget is the full pool')
})

test('the pool drawn says why it is short, and holds what the device is asked for', () => {
  for (const [budget, clamp] of [
    [bytesAt(2048), null],
    [bytesAt(2048) - 1, 'ceiling'],
    [bytesAt(256), 'minimum'],
  ] as const) {
    const pool = vsmPoolWithin(budget, SUN)!
    assert.equal(pool.clamp, clamp)
    assert.equal(pool.budgetBytes, budget)
    const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: BINDING } })
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

test('the 2048-page pool is two slices of 128 MiB, the 1024-page pool two of 64 MiB', () => {
  for (const [pages, slice] of [
    [2048, 134_217_728],
    [1024, 67_108_864],
  ]) {
    const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: BINDING } })
    createVsmResources(fake.device, { ...SUN, poolPages: pages })
    for (const label of ['vsm.physicalPool0.0', 'vsm.physicalPool1.0'])
      assert.equal(fake.buffers.find((b) => b.label === label)?.size, slice, `${pages}: ${label}`)
  }
})

test('vsmTransmissionBytes is every byte the ledger counts of a transmission', () => {
  for (const pages of [2048, 256])
    for (const scale of [1, 4]) {
      const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: BINDING } })
      const ledger = installGpuDeviceLedger(fake.device)
      const layout = vsmLayout({ ...SUN, poolPages: pages })
      const first = vsmTransmissionFirstCaps(pages)
      const caps = { ...first, blocks: first.blocks * scale, records: first.records * scale }
      const trans = createVsmTransmission(fake.device, layout, caps)
      assert.equal(ledger.bytes, vsmTransmissionBytes(layout, caps), `${pages}, ${scale}`)
      assert.equal(trans.bytes, ledger.bytes)
      trans.destroy()
      assert.equal(ledger.bytes, 0, 'destroy frees every byte')
    }
})

// Every world reserved the 2048-page pool whatever its canvas: six small feeds held 2 GB of
// shadows.
test('the pool a view starts at follows its pixels, between the eighth and the full pool', () => {
  assert.equal(vsmViewPoolPages(1920, 1080), VSM_POOL_PAGES, 'the reference view: the full pool')
  assert.equal(vsmViewPoolPages(3000, 1800), VSM_POOL_PAGES, 'past it: never more')
  assert.equal(vsmViewPoolPages(990, 888), 512, 'a share of the pixels, a power of two down')
  assert.equal(vsmViewPoolPages(320, 240), VSM_POOL_PAGES / 8, 'never under the eighth')
})

test('a fill past the pressure load asks the pool that holds it, the full pool at most', () => {
  assert.equal(vsmDemandPages(512, 300, 0), 0, 'within the load: nothing asked')
  assert.equal(vsmDemandPages(512, 0, 0), 1024, 'full: the power of two that holds it at the load')
  assert.equal(vsmDemandPages(256, -100, 0), 512, 'overflowing: what it wanted')
  assert.equal(vsmDemandPages(256, 0, 1), 2048, 'a level coarser hid four times the pages')
  assert.equal(vsmDemandPages(2048, -5000, 2), VSM_POOL_PAGES)
})
