// The material table's displacement records: written at the surface's rank beside the table, read by
// the tessellation by rank, and the reach a displacement moves a point by.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable } from './materialTable.ts'
import { DISPLACEMENT_RECORD, DISPLACEMENT_WORDS } from './displacementRecord.ts'
import {
  fadeOutPixels,
  displacementRange,
  pagesDisplacementReach,
} from '../../visibility/tessellation/numbers.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TESS_READ_PLAIN_WGSL } from '../../visibility/tessellation/queueWgsl.ts'
import { MATERIAL_RANK_MASK } from '../../visibility/types.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import type { SurfaceDisplacement } from '../../visibility/materialType.ts'

const lit = () => ({ ...surfaceOf([]), lit: true })

test('a displaced surface has its record written at its rank beside the table, and cleared with it', () => {
  const table = createMaterialTable()
  const height = { channel: 2 } as Texture
  const l = { mapLayer: new Map<Texture, number>(), dataLayer: new Map([[height, 6]]) }
  const D = DISPLACEMENT_RECORD.at
  assert.equal(table.displaced.count, 0, 'a scene without one holds none')
  assert.equal(table.displaced.ints.length, 0, 'and allocates none')
  table.surface(lit(), l)
  const displacement: SurfaceDisplacement = {
    magnitude: 4,
    center: 0.5,
    fade: { start: 4, end: 1 },
  }
  const surface = { ...lit(), version: 0, displacementMap: height, displacement }
  const { rank } = table.surface(surface, l)
  const words = table.displaced.ints,
    floats = new Float32Array(words.buffer),
    at = rank * DISPLACEMENT_WORDS
  assert.equal(rank, 1)
  assert.deepEqual([...floats.slice(at + D.scale, at + D.scale + 4)], [4, 0.5, 4, 1])
  assert.deepEqual([words[at + D.map], words[at + D.map + 1]], [6, 2], 'the slot, the texture set')
  assert.deepEqual(
    [...floats.slice(at + D.density, at + D.density + 8)],
    [0, 0, 0, 0, 0, 0, 0, 0],
    'unmeasured',
  )
  assert.equal(table.displaced.count, 1)
  // The densities the compiler measured, 0 for a set it did not: a change of them alone is one.
  const measured = table.displaced.version
  surface.displacement = { ...surface.displacement, uvDensities: [2, 0.5, 0, 8, 0, 3, 0, 0.25] }
  surface.version = 1
  table.surface(surface, l)
  assert.deepEqual(
    [...floats.slice(at + D.density, at + D.density + 8)],
    [2, 0.5, 0, 8, 0, 3, 0, 0.25],
  )
  assert.ok(table.displaced.version > measured)
  // A fade that never fades writes zero for both ends; the count holds, the version moves.
  const version = table.displaced.version
  surface.displacement = { magnitude: 2, center: 0, fade: null }
  surface.version = 2
  table.surface(surface, l)
  assert.deepEqual([...floats.slice(at, at + 4)], [2, 0, 0, 0])
  assert.deepEqual([table.displaced.count, table.displaced.version > version], [1, true])
  // A surface that stops being displaced, or whose height map the atlas lost, is drawn flat.
  surface.version = 3
  l.dataLayer.delete(height)
  table.surface(surface, l)
  assert.deepEqual(
    [...words.slice(at, at + DISPLACEMENT_WORDS)],
    new Array(DISPLACEMENT_WORDS).fill(0),
  )
  assert.equal(table.displaced.count, 0)
})

test('the tessellation reads a row’s record from the region of its buffer the records fill, by rank', () => {
  // Three records written as the table sends them, at word 100 of the buffer, each its rank's.
  const tess = new Uint32Array(100 + 3 * DISPLACEMENT_WORDS),
    floats = new Float32Array(tess.buffer)
  for (let rank = 0; rank < 3; rank++) {
    const at = 100 + rank * DISPLACEMENT_WORDS,
      D = DISPLACEMENT_RECORD.at
    floats.set([rank + 1, 0.5, 4, 1], at + D.scale)
    floats.set([-1, rank + 2, 0, 0], at + D.bounds)
    tess.set([20 + rank, 1, 0, 0], at + D.map)
    floats.set([rank + 3, 0, 0.25, 0], at + D.density)
  }
  const { displacementOf } = shaderRun<{
    displacementOf(page: { material: number }): Record<string, number[]>
  }>(wgslBlock('records', [TESS_READ_PLAIN_WGSL], ''), ['tw', 'tw4', 'displacementOf'], {
    tess,
    tu: { dispBase: 100 },
    MATERIAL_RANK_MASK,
  })
  const row = displacementOf({ material: 1 | (1 << 31) })
  const words = (name: 'scale' | 'bounds' | 'map' | 'density') => row[name]
  assert.deepEqual(words('scale'), [2, 0.5, 4, 1])
  assert.deepEqual(words('bounds'), [-1, 3, 0, 0])
  assert.deepEqual(words('map'), [21, 1, 0, 0])
  assert.deepEqual(words('density'), [4, 0, 0.25, 0])
})

test('the distances a displacement moves a point by hold zero, ordered whichever way the magnitude points', () => {
  // The heights 0 and 1 against the centre that stays on the surface, times the magnitude.
  assert.deepEqual(displacementRange({ magnitude: 2, center: 0.25 }), { min: -0.5, max: 1.5 })
  assert.deepEqual(displacementRange({ magnitude: -2, center: 0.25 }), { min: -1.5, max: 0.5 })
  // A centre of zero never goes in; of one, never out; the range still holds zero.
  assert.deepEqual(displacementRange({ magnitude: 3, center: 0 }), { min: 0, max: 3 })
  assert.deepEqual(displacementRange({ magnitude: 3, center: 1 }), { min: -3, max: 0 })
  // Faded out at the smaller of the two ends, never for a displacement that does not fade.
  assert.equal(fadeOutPixels({ fade: { start: 4, end: 2 } }), 2)
  assert.equal(fadeOutPixels({ fade: null }), 0)
  // What a primitive's boxes grow by: the greatest reach of the displaced surfaces of its pages.
  const height = {} as Texture
  const page = (displacement: SurfaceDisplacement | undefined) => ({
    material: { displacement, displacementMap: displacement && height },
  })
  assert.equal(pagesDisplacementReach([]), 0)
  assert.equal(pagesDisplacementReach([page(undefined), page(undefined)]), 0)
  assert.equal(
    pagesDisplacementReach([
      page({ magnitude: 2, center: 0.25, fade: null }),
      page(undefined),
      page({ magnitude: 4, center: 0.5, fade: null }),
    ]),
    2,
  )
})

test('a surface whose graph wires a displacement has a record with no map: the mark, the surface’s own rank and the set the output reads', () => {
  const table = createMaterialTable()
  const l = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const D = DISPLACEMENT_RECORD.at
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('displacement', graph.componentMask(graph.texCoord(2), 'r'))
  const displacement: SurfaceDisplacement = { magnitude: 3, center: 0.25, fade: null }
  const { rank } = table.surface({ ...lit(), version: 0, graph, displacement }, l)
  const words = table.displaced.ints,
    floats = new Float32Array(words.buffer),
    at = rank * DISPLACEMENT_WORDS
  assert.deepEqual([...floats.slice(at + D.scale, at + D.scale + 2)], [3, 0.25])
  assert.deepEqual(
    [...words.slice(at + D.map, at + D.map + 4)],
    [0, 2, 1, rank],
    'no slot, the set, the graph’s mark, the rank',
  )
  assert.equal(table.displaced.count, 1)
  // The numbers alone, with no graph output nor map, leave the surface flat.
  const flat = table.surface({ ...lit(), version: 0, displacement }, l)
  assert.equal(words[flat.rank * DISPLACEMENT_WORDS + D.map + 2] ?? 0, 0)
  // Its reach grows the culling boxes as a map's does.
  assert.ok(
    pagesDisplacementReach([{ material: { graph, displacement } }]) > 0,
    'a displacement a graph gives moves points',
  )
})
