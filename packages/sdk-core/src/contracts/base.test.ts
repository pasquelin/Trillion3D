import assert from 'node:assert/strict'
import { basename, extname } from 'node:path'
import test from 'node:test'
import { CUTOUT_SHEET_FILE } from './writtenFormats.ts'
import { DEFAULT_SCOPE, SDK_VERSION } from './base.ts'
import { assertCachePointer } from './cache.ts'
import { jobOptionFields, jobOptionFlags } from './jobOptions.ts'
import { resolveHlod } from './hlodOptions.ts'

test('the engine version parses as major.minor.patch for a host', () => {
  const parts = SDK_VERSION.split(/[-+]/)[0].split('.').map(Number)
  assert.equal(parts.length, 3, SDK_VERSION)
  for (const part of parts) assert.ok(Number.isSafeInteger(part) && part >= 0, SDK_VERSION)
})

test('a model compiled at the default scope streams in pages', () => {
  const pointer = { status: 'ready', url: 'model/clusters.json', scope: DEFAULT_SCOPE }
  assert.equal(assertCachePointer(pointer, 'slice'), 'model/clusters.json')
})

test('the cut-out answer sheet is one JSON file at the cache root', () => {
  assert.equal(basename(CUTOUT_SHEET_FILE), CUTOUT_SHEET_FILE)
  assert.equal(extname(CUTOUT_SHEET_FILE), '.json')
  assert.ok(CUTOUT_SHEET_FILE.length > '.json'.length)
})

test('a job naming streaming grids writes them as the compiler reads them and refuses the rest', () => {
  const grids = [{ cellSize: 64 }, { name: 'far', cellSize: 512, loadingRange: 1024 }]
  const wire = [
    { cellSize: 64, loadingRange: 256, priority: 0, origin: [0, 0] },
    { name: 'far', cellSize: 512, loadingRange: 1024, priority: 0, origin: [0, 0] },
  ]
  assert.deepEqual(jobOptionFields({ partitionGrids: grids }).partitionGrids, wire)
  assert.deepEqual(jobOptionFlags({ partitionGrids: grids }), [
    `--partition-grids=${JSON.stringify(wire)}`,
  ])
  assert.deepEqual(jobOptionFields({}), {}, 'a job naming none names none')
  const refused: [object, RegExp][] = [
    [{ partitionGrid: true, partitionGrids: [{}] }, /name them once/],
    [{ partitionGrids: [] }, /one grid or more/],
    [{ partitionGrids: [{}, {}] }, /partitionGrids\[1\]: name is required/],
    [{ partitionGrids: [{}, { name: 'a:b' }] }, /none of :\./],
    [{ partitionGrids: [{ name: 'A' }, { name: 'a' }] }, /names a grid already/],
    [
      { partitionScheme: 'spatialHash', partitionGrids: [{}, { name: 'x', nestedLevels: true }] },
      /nestedLevels is the whole partition's/,
    ],
    [{ partitionGrids: [{ cellSize: 0 }] }, /partitionGrids\[0\]: cellSize/],
    [{ partitionScheme: 'spatialHash', partitionGrids: [{ flat: false }] }, /read by .* alone/],
    [{ objectSettings: { runtimeGrid: '' } }, /runtimeGrid must be the name of a streaming grid/],
    [{ objectSettings: { runtimeGrid: 'a.b' } }, /runtimeGrid must be .* none of :\./],
  ]
  for (const [options, message] of refused)
    assert.throws(() => jobOptionFields(options), message, JSON.stringify(options))
  // Flatness is each grid's own; a square setting a later grid names alike is the partition's.
  assert.ok(jobOptionFields({ partitionGrids: [{}, { name: 'x', flat: false }] }).partitionGrids)
  const alike = [{ nestedLevels: true }, { name: 'x', nestedLevels: true }]
  assert.ok(jobOptionFields({ partitionScheme: 'spatialHash', partitionGrids: alike }))
  const rule = { objects: [{ match: 'far', runtimeGrid: 'far' }] }
  assert.deepEqual(jobOptionFields({ objectSettings: rule }).objectSettings, {
    objects: [{ match: { node: 'far' }, runtimeGrid: 'far' }],
  })
})

test('the simple HLOD form takes a main chain of one level: always loaded, the props with it', () => {
  const layers = (levels: number) => resolveHlod({ levels })!.layers
  const named = (levels: number, name: string) => layers(levels).find((l) => l.name === name)
  assert.deepEqual(
    layers(1).map((layer) => layer.name),
    ['hlod0', 'foliage0', 'foliage1', 'props0'],
  )
  assert.deepEqual(named(1, 'hlod0'), {
    name: 'hlod0',
    builder: 'instanced',
    spatiallyLoaded: false,
  })
  assert.deepEqual(named(1, 'props0'), {
    name: 'props0',
    builder: 'instanced',
    spatiallyLoaded: false,
  })
  // Two levels or more: the props' cells are absorbed by the first merged layer, as before.
  assert.equal(named(2, 'props0')?.parent, 'hlod1')
  assert.equal(named(2, 'props0')?.spatiallyLoaded, undefined)
  for (const levels of [0, 257, 1.5, Number.NaN])
    assert.throws(() => resolveHlod({ levels }), /levels must be a whole number from 1 to 256/)
})
