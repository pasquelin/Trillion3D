import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSceneTables } from './tableContracts.ts'
import { assertCellNodes } from './tableCell.ts'
import { readCellPage, RUNGS, tablePartition } from './tablePartition.ts'

const hasCode =
  (code: string, text = '') =>
  (error: unknown) =>
    (error as { code?: string }).code === code && (error as Error).message.includes(text)

/** Tables at the versions this runtime reads, every table empty. */
const tables = () => ({
  version: 7,
  nodeTableVersion: 5,
  materialTableVersion: 4,
  geometryTableVersion: 1,
  scene: { name: null, nodes: [] },
  nodes: [],
  meshPages: [],
  lights: [],
  cameras: [],
  skins: [],
  animations: [],
  materials: [],
  textures: [],
  document: { buffer: 'source.bin', views: [], accessors: [], meshes: [], images: [] },
  partition: null,
})

test('tables of an unknown version are refused rather than half-read', () => {
  assert.doesNotThrow(() => assertSceneTables(tables()))
  for (const field of ['version', 'nodeTableVersion', 'materialTableVersion'] as const)
    assert.throws(
      () => assertSceneTables({ ...tables(), [field]: 1 }),
      hasCode('UNSUPPORTED_SCENE_TABLES', `${field} 1`),
    )
  // #519: a node table of version 3 says no node's visibility; it is refused, never read visible.
  assert.throws(
    () => assertSceneTables({ ...tables(), nodeTableVersion: 3 }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'nodeTableVersion 3'),
  )
  assert.throws(
    () => assertSceneTables({ ...tables(), geometryTableVersion: 99 }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'geometryTableVersion 99'),
  )
  // Issue #275: the refusal says what to do — recompile the cache, and with which command.
  assert.throws(
    () => assertSceneTables({ ...tables(), materialTableVersion: 3 }),
    hasCode(
      'UNSUPPORTED_SCENE_TABLES',
      'recompile it with this one (pnpm run build:native, then trillion3d-compiler',
    ),
  )
  assert.throws(() => assertSceneTables(null), hasCode('INVALID_SCENE_TABLES'))
})

test('tables that lay out no document are refused by name', () => {
  const { document: _, ...without } = tables()
  assert.throws(
    () => assertSceneTables(without),
    (error: unknown) =>
      hasCode('INVALID_SCENE_TABLES')(error) &&
      (error as { details?: { missing?: string[] } }).details?.missing?.includes('document') ===
        true,
  )
})

/** A slot naming the page whose digest ends in `digest`, boxed by `box`, as the compiler writes it. */
function slot(digest: string, box: number[]) {
  const bits = new DataView(new ArrayBuffer(8))
  const hex = (value: number) => (bits.setFloat64(0, value), bits.getBigUint64(0).toString(16))
  return `${digest.padStart(64, '0')}00000001${box.map((v) => hex(v).padStart(16, '0')).join('')}`
}
const EMPTY = '0'.repeat(168)
/** A mesh entry of the root: its rank and total, then its rows at each rung. */
const mesh = (rank: number, total: number, rows: (rung: number) => number) =>
  [rank, total, ...Array.from({ length: RUNGS }, (_, rung) => rows(rung))]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')
/** The first rung's side, 16 m, as the bits of its `f64`. */
const CUBE = '4030000000000000'
const cells = (...ranks: number[]) =>
  ranks.map((at) => ({ url: `${at}`, parents: [], meshes: [[at, 1]] }))

test('a partition root of another version or shape is refused, and a cell is read only at its own', () => {
  const partition = {
    version: 4,
    pages: Array(8).fill(EMPTY),
    parents: Array(8).fill(''),
    meshes: [],
    cube: CUBE,
  }
  assert.deepEqual(assertSceneTables({ ...tables(), partition }).partition, partition)
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, version: 3 } }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'partition version 3'),
  )
  // The rows and parents a root carries are fixed-width hexadecimal (#575).
  for (const shape of [{ meshes: [7] }, { meshes: ['0'.repeat(16)] }, { parents: ['a'] }])
    assert.throws(
      () => assertSceneTables({ ...tables(), partition: { ...partition, ...shape } }),
      hasCode('INVALID_SCENE_TABLES'),
    )
  // A root is a fixed number of slots: fewer is not a root this runtime reads.
  assert.throws(
    () => assertSceneTables({ ...tables(), partition: { ...partition, pages: [EMPTY] } }),
    hasCode('INVALID_SCENE_TABLES'),
  )
  assert.deepEqual(assertCellNodes({ version: 2, nodes: [] }), [])
  assert.throws(() => assertCellNodes({ version: 1, nodes: [] }), hasCode('INVALID_SCENE_TABLES'))
})

test('the root gives its slots, box, rows and parents; a page is read alone, checked', () => {
  // The root names an index page `a` and a region page `b`; `a` names the region pages `c`, `d`.
  const [m, n] = [slot('e', [0, 0, 0, 0, 0, 0]), slot('f', [0, 0, 0, 0, 0, 0])]
  const [a, b] = [slot('a', [0, 0, 0, 2, 1, 1]), slot('b', [-3, 0, 0, -2, 5, 1])]
  const meshes = [mesh(0, 2, () => 2), mesh(3, 17, (rung) => Math.min(17, rung + 1))]
  const root = {
    version: 4,
    pages: [a, b, ...Array(6).fill(EMPTY)],
    parents: ['0000000a', '0000000a00000002', ...Array(6).fill('')],
    meshes,
    cube: CUBE,
  }
  const partition = tablePartition(root)
  assert.deepEqual(partition.bounds, [-3, 0, 0, 2, 5, 1])
  assert.deepEqual(
    [partition.meshes, [...partition.totals]],
    [
      [0, 3],
      [
        [0, 2],
        [3, 17],
      ],
    ],
  )
  assert.deepEqual(partition.parents, [2, 10])
  assert.deepEqual(
    partition.pages.map(({ parents }) => parents),
    [[10], [10, 2]],
  )
  assert.deepEqual([partition.cube, partition.rows.get(3)!.slice(0, 3)], [16, [1, 2, 3]])
  assert.deepEqual(
    partition.pages.map(({ page }) => page.url),
    ['a', 'b'].map((digest) => `scene-page-${digest.padStart(64, '0')}.json`),
  )
  const read = (body: unknown) => readCellPage(new TextEncoder().encode(JSON.stringify(body)), 'p')
  const index = read({
    version: 4,
    pages: [slot('c', [0, 0, 0, 1, 1, 1]), EMPTY],
    parents: ['', ''],
  })
  assert.deepEqual(
    [index.pages!.map(({ bounds }) => bounds), index.cells],
    [[[0, 0, 0, 1, 1, 1]], null],
  )
  // An index page lists beside each page the parents its cells hang under.
  assert.throws(
    () => read({ version: 4, pages: [EMPTY] }),
    hasCode('INVALID_SCENE_TABLES', 'parents'),
  )
  const region = read({ version: 4, first: 7, cells: cells(0, 1), meshPages: [m, n] })
  assert.deepEqual(
    region.cells!.map(({ url, meshPages }) => [url, meshPages]),
    [
      ['0', [m, n]],
      ['1', [m, n]],
    ],
  )
  // A page of another version, of neither pages nor cells, or naming a mesh page that is no slot,
  // is refused.
  assert.throws(
    () => read({ version: 3, cells: [] }),
    hasCode('UNSUPPORTED_SCENE_TABLES', 'version 3'),
  )
  assert.throws(() => read({ version: 4 }), hasCode('INVALID_SCENE_TABLES'))
  const badSlot = { version: 4, first: 0, cells: cells(3), meshPages: ['e'] }
  // A region page names the cook's rank of its first cell, which the world roots number it by.
  assert.equal(region.first, 7)
  assert.throws(
    () => read({ version: 4, cells: cells(0), meshPages: [m] }),
    hasCode('INVALID_SCENE_TABLES', 'first cell'),
  )
  assert.throws(() => read(badSlot), hasCode('INVALID_SCENE_TABLES', 'mesh pages'))
  assert.throws(
    () => read({ version: 4, pages: ['z'.repeat(168)], parents: [''] }),
    hasCode('INVALID_SCENE_TABLES'),
  )
})
