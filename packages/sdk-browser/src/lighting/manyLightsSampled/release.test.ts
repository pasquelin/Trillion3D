import test from 'node:test'
import assert from 'node:assert/strict'
import { partOf, releasePart, releaseSampledLightsView, viewRecord } from './release.ts'

test('a part of the record is made once and freed, its field cleared, with the record', () => {
  const device = {} as GPUDevice
  const gpu = { viewKey: {} }
  const record = viewRecord(gpu, device)
  let made = 0
  const freed: unknown[] = []
  const make = () => (made++, { volume: { dispose() {} }, fogGroups: [], cellGroups: [] }) as never
  const first = partOf(record, 'volumes', make, (part) => freed.push(part))
  assert.equal(
    partOf(record, 'volumes', make, (part) => freed.push(part)),
    first,
  )
  assert.equal(made, 1)
  releaseSampledLightsView(gpu)
  assert.deepEqual(freed, [first])
  assert.equal(record.volumes, undefined)
})

test('one part is freed alone and made again at its next ask', () => {
  const gpu = { viewKey: {} }
  const record = viewRecord(gpu, {} as GPUDevice)
  const freed: unknown[] = []
  const make = () => ({ n: freed.length }) as never
  const first = partOf(record, 'surface', make, (part) => freed.push(part))
  const other = partOf(record, 'front', make, (part) => freed.push(part))
  releasePart(record, 'surface')
  assert.deepEqual(freed, [first])
  assert.equal(record.surface, undefined)
  assert.equal(record.front, other)
  assert.notEqual(
    partOf(record, 'surface', make, (part) => freed.push(part)),
    first,
  )
  releaseSampledLightsView(gpu)
  assert.equal(freed.length, 3)
})
