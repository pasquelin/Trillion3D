import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planCascadeCaches, type CascadeRecord, type CascadeRoots } from './csmCache.ts'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const light = { direction: [0, 0, -1] as [number, number, number], rotation: identity }
const settings = { enabled: true, overlapAreaThrottle: 0.75, maxExtraStaticSubjects: 5 }
const none: CascadeRoots = { count: 0, objectAt: () => ({}), staticBox: () => undefined }
const at = (x: number, level = 0) => [
  { centre: [x, 0, 0] as [number, number, number], radius: 10, level },
]

test('the first frame draws the cache, a still one keeps it, a small slide scrolls it, a large one draws it again', () => {
  const records: CascadeRecord[] = []
  assert.deepEqual([...planCascadeCaches(settings, records, at(0), light, none)], [0])
  assert.deepEqual([...planCascadeCaches(settings, records, at(0), light, none)], [])
  assert.deepEqual([...planCascadeCaches(settings, records, at(2), light, none)], [])
  assert.equal(records[0]!.centre[0], 0)
  assert.deepEqual([...planCascadeCaches(settings, records, at(9), light, none)], [0])
  assert.equal(records[0]!.centre[0], 9)
})

test('a turned light or a changed level draws the cascade’s cache again, the cascade named by its index', () => {
  const records: CascadeRecord[] = []
  planCascadeCaches(settings, records, at(0), light, none)
  const turned = { ...light, direction: [0, 1, 0] as [number, number, number] }
  assert.deepEqual([...planCascadeCaches(settings, records, at(0), turned, none)], [0])
  assert.deepEqual([...planCascadeCaches(settings, records, at(0, 1), turned, none)], [0])
})

test('too many static casters drawn again in the strips draw the cache again the next frame', () => {
  const boxes = Array.from({ length: 8 }, () => [9, -1, -1, 12, 1, 1])
  const objects = boxes.map(() => ({}))
  const roots: CascadeRoots = {
    count: 8,
    objectAt: (r) => objects[r]!,
    staticBox: (r) => boxes[r],
  }
  const records: CascadeRecord[] = []
  planCascadeCaches(settings, records, at(0), light, roots)
  planCascadeCaches(settings, records, at(1), light, roots)
  assert.equal(records[0]!.extra, 8)
  assert.deepEqual([...planCascadeCaches(settings, records, at(1.5), light, roots)], [0])
})
