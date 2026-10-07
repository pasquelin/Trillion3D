import test from 'node:test'
import assert from 'node:assert/strict'
import {
  finestExponent,
  gridExponent,
  primitiveGridExponent,
  tileLog2,
  uvGridExponent,
} from './gridExponent.ts'

// The cases of the Rust rules' own tests (`asset-compiler-rust` `geometry_page_quant/tile_tests.rs`,
// `tile_quantum_tests.rs`), held by the TypeScript twin of `bits/grid.rs`.

const TILE = 1,
  UNTILED = 2 ** 31 - 1
const untiled = (extent: number, error: number | null) => gridExponent(extent, error, UNTILED)
/** Extents and errors a primitive can publish, the hostile ones included. */
const EDGES = [
  0,
  -0,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_VALUE,
  2 ** -1022,
  5e-324,
  1,
  32,
  63.999,
  64,
]

let state = 930
const unit = () => (
  (state ^= state << 13),
  (state ^= state >>> 17),
  (state ^= state << 5),
  (state >>> 0) / 2 ** 32
)

test('a primitive narrower than a tile keeps its grid', () => {
  const bound = 2 ** (TILE + 1)
  for (let i = 0; i < 100_000; i++) {
    const extent = unit() * bound,
      pick = i % 3,
      error = pick === 0 ? null : pick === 1 ? unit() * 4 : 2 ** (Math.floor(unit() * 80) - 60)
    assert.equal(gridExponent(extent, error, TILE), untiled(extent, error), `${extent} ${error}`)
  }
  for (const extent of EDGES.filter((e) => Number.isNaN(e) || e < bound))
    for (const error of [...EDGES, null])
      assert.equal(gridExponent(extent, error, TILE), untiled(extent, error), `${extent} ${error}`)
  // An empty primitive and a single point: no extent, the grid they had.
  assert.equal(gridExponent(0, null, TILE), untiled(0, null))
})

test('a wider primitive is never coarser and its widest page still fits', () => {
  for (let i = 0; i < 100_000 + EDGES.length; i++) {
    const extent = i < 100_000 ? 2 ** (unit() * 40 - 8) : EDGES[i - 100_000],
      error = i % 2 ? unit() * 16 : null,
      tiled = gridExponent(extent, error, TILE)
    assert.ok(tiled <= untiled(extent, error), `${extent} ${error}`)
    if (Number.isFinite(extent) && extent > 0)
      assert.ok(extent / 2 ** tiled < 2 ** 24 || tiled === 64, `${extent}`)
  }
})

test('the tile is measured in metres of the world, and an extreme scale still fits the field', () => {
  for (let i = 0; i < 100_000; i++) {
    const scale = 2 ** (unit() * 24 - 12),
      extent = (unit() * 2) / scale,
      error = i % 2 ? unit() / scale : null
    assert.equal(gridExponent(extent, error, tileLog2(scale)), untiled(extent, error))
  }
  // A 3,720-unit hall at a scale of 0.008 is no coarser a world step than one in metres.
  assert.ok(2 ** gridExponent(3720, null, tileLog2(0.008)) * 0.008 <= 2 ** (TILE - 16))
  // A kilometre terrain modelled in kilometres: its widest page limits the grid.
  assert.equal(gridExponent(1.024, null, tileLog2(1e3)), finestExponent(1.024))
  for (const scale of [null, NaN, 0, -0, -1, Infinity, -Infinity])
    assert.equal(tileLog2(scale), TILE)
  for (const scale of [5e-324, 2 ** -1022, Number.MAX_VALUE])
    for (const extent of EDGES)
      assert.ok(Math.abs(gridExponent(extent, null, tileLog2(scale))) <= 64, `${extent} ${scale}`)
})

test("the documented grids: a hall on the tile's, a kilometre on its root page's, the field's bounds", () => {
  assert.equal(gridExponent(32, null, TILE), TILE - 16)
  assert.equal(finestExponent(1024), -13)
  assert.equal(gridExponent(1024, null, TILE), -13)
  // A metre of drawn triangles takes the compiler's 2^-16, not the finest 2^-23 a page holds.
  assert.equal(primitiveGridExponent(1, null, false, tileLog2(null)), -16)
  assert.equal(primitiveGridExponent(1, null, true, tileLog2(null)), -23)
  // Rust's saturating `as i32` and the ±64 clamp: the step stays a normal 32-bit float.
  assert.equal(finestExponent(1e-300), -64)
  assert.equal(finestExponent(Infinity), 64)
  assert.equal(finestExponent(NaN), -23)
  assert.equal(gridExponent(Infinity, 1e-300, TILE), 64)
  assert.equal(gridExponent(1, 5e-324, TILE), finestExponent(1))
})

test("texture coordinates take the format's grid, a blended primitive's the finest its span fits", () => {
  assert.equal(uvGridExponent(4096, false), -14)
  assert.equal(uvGridExponent(0, true), -14)
  assert.equal(uvGridExponent(1, true), -23)
  assert.equal(uvGridExponent(2 ** 20, true), -14)
  assert.equal(uvGridExponent(1e-30, true), -64)
})
