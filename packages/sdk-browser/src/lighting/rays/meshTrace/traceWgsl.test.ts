// The meshes' fields trace: a ray through a mesh's field, run on the shipped text with a sphere for the field (a mesh whose
// volume is the cube of half-size 1, a hundred centimetres a volume unit, holding a sphere of radius 0.5): the nearest surface
// it meets, the box it misses, the lists' room, the normal at the hit and the cell a pixel falls in.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { meshTraceWgsl } from './traceWgsl.ts'

const len = (v: number[]) => Math.hypot(...v)

const mesh = {
  extent: [1, 1, 1],
  surfaceBias: 0.01,
  mostlyTwoSided: false,
  asset: 0,
  volumeScale: 100,
  instance: 7,
  rows: [
    [0.01, 0, 0, 0],
    [0, 0.01, 0, 0],
    [0, 0, 0.01, 0],
  ],
}

function tracing(cells: number[], indices: number[], limit = 8) {
  return shaderRun<{
    msdfTraceCell: (ray: object, cell: number) => { distance: number; object: number }
    msdfTraceDerived: (
      ray: object,
      hit: { distance: number; object: number },
    ) => { normal: number[]; instance: number }
    msdfCellIndex: (pixel: number[], depth: number) => number
  }>(meshTraceWgsl(0, 0), ['msdfTraceCell', 'msdfTraceDerived', 'msdfCellIndex'], {
    msdf: {
      trace: [0.6, 32, 0.1, 0],
      limits: [limit, 0, 0, 0],
      grid: [4, 3, 20, 6],
      zParams: [0.01, 1, 4, 0],
    },
    msdfCells: cells,
    msdfIndices: indices,
    loadDfObjectData: () => mesh,
    dfWorldToVolume: (_: unknown, world: { hi: number[]; lo: number[] }) =>
      world.hi.map((x, k) => (x + world.lo[k]) / 100),
    dfAssetMip: () => ({ numMips: 1, scaleBias: [1, 0], toIndirectionScale: [1, 1, 1] }),
    sampleSparseMeshSdf: (p: number[]) => len(p) - 0.5,
  })
}

const rayAt = (x: number, dithered = false) => ({
  start: [x, 0, -300],
  dir: [0, 0, 1],
  minTrace: 0,
  maxTrace: 600,
  expandByTime: true,
  initialMax: 0,
  dithered,
  ditherCoord: [0, 0],
})

test('a ray through the sphere hits its surface, one beside the mesh keeps the end of its range', () => {
  const trace = tracing([1, 0], [0])
  const hit = trace.msdfTraceCell(rayAt(0), 0)
  // The surface is 250 centimetres along; it is pulled back by the expansion, a bias at most (1 cm).
  assert.ok(hit.distance > 246 && hit.distance <= 250.5, `hit at ${hit.distance}`)
  assert.equal(hit.object, 0)
  assert.equal(trace.msdfTraceCell(rayAt(150), 0).distance, 600, 'a ray off the box meets nothing')
})

test('a cell lists no more than the room the lists have', () => {
  const trace = tracing([5, 0], [0], 1)
  assert.ok(trace.msdfTraceCell(rayAt(0), 0).distance < 600, 'the first mesh is traced')
  assert.equal(
    tracing([0, 0], [0]).msdfTraceCell(rayAt(0), 0).distance,
    600,
    'an empty cell hits nothing',
  )
})

test("the normal at the hit points out of the sphere, the instance is the mesh's", () => {
  const trace = tracing([1, 0], [0])
  const ray = rayAt(0)
  const derived = trace.msdfTraceDerived(ray, { distance: 250, object: 0 })
  assert.ok(Math.abs(derived.normal[2] + 1) < 1e-6 && Math.abs(derived.normal[0]) < 1e-6)
  assert.equal(derived.instance, 7)
})

test('a pixel at a depth falls in the cell of its column and its depth slice', () => {
  const { msdfCellIndex } = tracing([0, 0], [0])
  // Pixel (130, 70) is in the cell (2, 1) of a 64-pixel grid; 1000 cm deep is slice floor(log2(11) * 4) = 13.
  assert.equal(msdfCellIndex([130, 70], 1000), (13 * 3 + 1) * 4 + 2)
  // Past the last slice the depth is held to it.
  assert.equal(msdfCellIndex([0, 0], 1e9), 19 * 3 * 4)
})
