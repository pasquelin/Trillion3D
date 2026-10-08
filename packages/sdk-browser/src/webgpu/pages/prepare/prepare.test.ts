// Lot F, F18: calculations of a WebGPU engine prepare. `indexSourceBytes` and
// `materialsAndTangentsCount` (../io/catalogue.ts) replace a `flatMap` of a pair per page and
// a `map`/two table copies with one walk each; their oracles are the implementations from before
// lot F. A page's cone is the collection's (`page/selection/cones.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { indexSourceBytes, materialsAndTangentsCount } from '../io/catalogue.ts'
import {
  referenceIndexSourceBytes,
  referenceMaterialsAndTangentsCount,
} from '../../../../../../bench/oracles/browser/normal-cones.ts'
import type { PageRec } from '../../../page/selection/selection.ts'

test('indexSourceBytes yields the same table as the reference flatMap, last page of a winning address', () => {
  const a = { url: 'p/0', array: Uint32Array.of(1, 2, 3) } as unknown as PageRec
  const b = { url: 'p/1', array: undefined } as unknown as PageRec // no bytes: absent from both
  const c = { url: 'p/0', array: Uint32Array.of(9, 9) } as unknown as PageRec // same address as a
  const pages = [a, b, c]
  const obtenu = indexSourceBytes(pages)
  const attendu = referenceIndexSourceBytes(pages)
  assert.deepEqual([...obtenu.keys()], [...attendu.keys()])
  for (const [url, bytes] of obtenu)
    assert.deepEqual(Array.from(bytes), Array.from(attendu.get(url) ?? new Uint8Array(0)))
})

test('indexSourceBytes on an empty catalogue yields an empty table', () => {
  assert.deepEqual(indexSourceBytes([]), referenceIndexSourceBytes([]))
})

test('materialsAndTangentsCount counts distinct materials and geometries with/without tangents', () => {
  const materialA = G.basicSurface(),
    materialB = G.basicSurface()
  const pages = [
    { material: materialA } as unknown as PageRec,
    { material: materialA } as unknown as PageRec, // same material, does not recount
    { material: materialB } as unknown as PageRec,
  ]
  const geometryBlocks = new Map<unknown, { hasTangent: boolean }>([
    ['g0', { hasTangent: true }],
    ['g1', { hasTangent: false }],
    ['g2', { hasTangent: true }],
  ])
  assert.deepEqual(
    materialsAndTangentsCount(pages, geometryBlocks),
    referenceMaterialsAndTangentsCount(pages, geometryBlocks),
  )
})

test('materialsAndTangentsCount on an empty catalogue and geometry table yields zeros', () => {
  assert.deepEqual(
    materialsAndTangentsCount([], new Map()),
    referenceMaterialsAndTangentsCount([], new Map()),
  )
})
