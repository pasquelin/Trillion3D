import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CASCADE_CACHE,
  cascadeCacheMode,
  overlapAreaRatio,
  scrollCopyRects,
  scrollDepthTransform,
  scrollOverlap,
  type CascadeBounds,
  type CascadeCacheState,
} from './csmScroll.ts'

const ON = { ...DEFAULT_CASCADE_CACHE, enabled: true }
const at = (x: number, y = 0, z = 0, radius = 100): CascadeBounds => ({ centre: [x, y, z], radius })
const STILL: CascadeCacheState = {
  valid: true,
  sameProjection: true,
  sameCentre: false,
  extraStaticSubjects: 0,
}

test('the cache is off by default, as the reference has it', () => {
  assert.equal(DEFAULT_CASCADE_CACHE.enabled, false)
  assert.equal(cascadeCacheMode(DEFAULT_CASCADE_CACHE, STILL, at(0), at(10)), 'uncached')
})

test('a cascade with no cache yet draws its static casters, a turned projection draws all', () => {
  assert.equal(cascadeCacheMode(ON, undefined, at(0), undefined), 'refresh')
  assert.equal(cascadeCacheMode(ON, { ...STILL, sameProjection: false }, at(0), at(0)), 'uncached')
})

test('a cache that moved little is scrolled, one that moved much is drawn again, one that did not move is copied as it is', () => {
  assert.equal(cascadeCacheMode(ON, { ...STILL, sameCentre: true }, at(0), at(0)), 'movable')
  assert.equal(cascadeCacheMode(ON, STILL, at(0), at(10)), 'scrolling')
  assert.equal(cascadeCacheMode(ON, STILL, at(0), at(150)), 'refresh')
})

test('a cache left with too many static casters, or of another size, is drawn again', () => {
  assert.equal(cascadeCacheMode(ON, { ...STILL, extraStaticSubjects: 6 }, at(0), at(10)), 'refresh')
  assert.equal(
    cascadeCacheMode(ON, { ...STILL, extraStaticSubjects: 5 }, at(0), at(10)),
    'scrolling',
  )
  assert.equal(cascadeCacheMode(ON, { ...STILL, valid: false }, at(0), at(10)), 'refresh')
})

test('the overlap ratio is the cached square less what the slide leaves out', () => {
  assert.equal(overlapAreaRatio(at(0), at(0)), 1)
  assert.equal(overlapAreaRatio(at(0), at(100)), 0.5)
  assert.equal(overlapAreaRatio(at(0), at(200)), 0)
  assert.equal(overlapAreaRatio(at(0), at(300)), 0)
})

test('a cache that slid half a side right reads its left half and writes the current map past its middle', () => {
  const o = scrollOverlap(at(0), at(100, 0, 7))
  assert.deepEqual(o.onCached, [0, 0, 0.5, 1])
  assert.deepEqual(o.onCurrent, [0.5, 0, 1, 1])
  assert.equal(o.zOffset, 7)
})

test('a slide up shifts the rectangles along v, which runs down', () => {
  const o = scrollOverlap(at(0), at(0, 100))
  assert.deepEqual(o.onCached, [0, 0.5, 1, 1])
  assert.deepEqual(o.onCurrent, [0, 0, 1, 0.5])
})

test('the border grows both squares, the shared part keeps its ratios', () => {
  const o = scrollOverlap(at(0), at(100), 1.5)
  assert.ok(Math.abs(o.onCached[2] - 2 / 3) < 1e-12)
  assert.ok(Math.abs(o.onCurrent[0] - 1 / 3) < 1e-12)
})

test('the depth copy is the identity for a map that did not move nor change range', () => {
  const range = { minZ: -50, maxZ: 50, invMaxSubjectDepth: 0.01 }
  const t = scrollDepthTransform(range, range, 0, 0)
  assert.equal(t.y, 1)
  assert.ok(Math.abs(t.x) < 1e-12)
})

test('the depth copy follows the range: a doubled range halves the depths, a slide along the axis offsets them', () => {
  const cached = { minZ: 0, maxZ: 100, invMaxSubjectDepth: 0.01 }
  const wider = scrollDepthTransform(
    cached,
    { minZ: 0, maxZ: 200, invMaxSubjectDepth: 0.005 },
    0,
    0,
  )
  assert.equal(wider.y, 0.5)
  const slid = scrollDepthTransform(cached, cached, 10, 0)
  assert.equal(slid.y, 1)
  assert.ok(Math.abs(slid.x - 0.001) < 1e-12)
})

test('the copy rectangles are the overlap in pixels, rounded as the draw rounds them', () => {
  const { source, output } = scrollCopyRects(scrollOverlap(at(0), at(100)), 1024)
  assert.deepEqual(source, { x: 0, y: 0, width: 512, height: 1024 })
  assert.deepEqual(output, { x: 512, y: 0, width: 512, height: 1024 })
})
