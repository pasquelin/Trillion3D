import test from 'node:test'
import assert from 'node:assert/strict'
import type { Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { PageRec } from './types.ts'
import { linkBundleDependencies } from './bundleDependencies.ts'
import { awaitedPages } from '../../webgpu/row/pageSlots.ts'

const recs = (names: string[]) => names.map((url) => ({ url }) as PageRec)
const primitive = (streams: number[], dependencies: number[][]) =>
  ({
    pages: streams.map((stream) => ({ stream })),
    streams: { pages: dependencies.map((list) => ({ url: 'b', dependencies: list })) },
  }) as unknown as Primitive

test("a record's dependencies are one record of each fetched bundle its bundle lists", () => {
  const pages = recs(['r', 'm', 'a', 'b'])
  linkBundleDependencies(primitive([0, 1, 2, 2], [[], [0], [0, 1]]), pages)
  const [r, m, a, b] = pages
  assert.deepEqual(r.dependencies, [])
  assert.deepEqual(m.dependencies, [r])
  assert.equal(a.dependencies, b.dependencies, 'one list per bundle, shared')
  assert.deepEqual(a.dependencies, [r, m])
  // A quantized geometry page is a slice of its bundle: its bundle is fetched and listed alike.
  const quantized = recs(['r', 'm'])
  quantized[0].geometryPage = {} as never
  linkBundleDependencies(primitive([0, 1], [[], [0]]), quantized)
  assert.deepEqual(quantized[1].dependencies, [quantized[0]])
})

test('a record with its bytes still awaits while a bundle it follows has none', () => {
  const pages = recs(['r', 'm', 'a'])
  linkBundleDependencies(primitive([0, 1, 2], [[], [0], [0, 1]]), pages)
  const [r, m, a] = pages
  r.array = a.array = new Uint32Array(1)
  assert.deepEqual(awaitedPages([r, a], []), [a], 'the parent outside the list is missing')
  m.array = new Uint32Array(1)
  assert.deepEqual(awaitedPages([r, a], []), [])
})
