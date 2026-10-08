import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drawnUvGridExponent,
  primitiveGridExponent,
  tileLog2,
  uvGridExponent,
} from './gridExponent.ts'
import { log2Integers } from './log2.fixture.ts'
import { xorshiftRandom } from '../../math/src/sequence/random.ts'

// The cases of the Rust rules' own tests (`asset-compiler-rust` `geometry_page_quant/tile_tests.rs`,
// `tile_quantum_tests.rs`), held by the TypeScript twin of `bits/grid.rs`.

const TILE = 1,
  UNTILED = 2 ** 31 - 1
/** The position grid of a primitive that is not blended (`gridExponent`, private to its module). */
const gridExponent = (extent: number, error: number | null, tile: number) =>
  primitiveGridExponent(extent, error, false, tile)
/** The finest grid of a positive span: a blended primitive's (`finest_exponent`). */
const finest = (span: number) => primitiveGridExponent(span, null, true, TILE)
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

const unit = xorshiftRandom(930)

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
  assert.equal(gridExponent(1.024, null, tileLog2(1e3)), finest(1.024))
  for (const scale of [null, NaN, 0, -0, -1, Infinity, -Infinity])
    assert.equal(tileLog2(scale), TILE)
  for (const scale of [5e-324, 2 ** -1022, Number.MAX_VALUE])
    for (const extent of EDGES)
      assert.ok(Math.abs(gridExponent(extent, null, tileLog2(scale))) <= 64, `${extent} ${scale}`)
})

test("the documented grids: a hall on the tile's, a kilometre on its root page's, the field's bounds", () => {
  assert.equal(gridExponent(32, null, TILE), TILE - 16)
  assert.equal(finest(1024), -13)
  assert.equal(gridExponent(1024, null, TILE), -13)
  // A metre of drawn triangles takes the compiler's 2^-16, not the finest 2^-23 a page holds.
  assert.equal(primitiveGridExponent(1, null, false, tileLog2(null)), -16)
  assert.equal(primitiveGridExponent(1, null, true, tileLog2(null)), -23)
  // Rust's saturating `as i32` and the ±64 clamp: the step stays a normal 32-bit float.
  assert.equal(finest(1e-300), -64)
  assert.equal(finest(Infinity), 64)
  assert.equal(gridExponent(Infinity, 1e-300, TILE), 64)
  assert.equal(gridExponent(1, 5e-324, TILE), finest(1))
})

test("texture coordinates take the format's grid, a blended primitive's the finest its span fits", () => {
  assert.equal(uvGridExponent(4096, false), -14)
  assert.equal(uvGridExponent(0, true), -14)
  assert.equal(uvGridExponent(1, true), -23)
  assert.equal(uvGridExponent(2 ** 20, true), -14)
  assert.equal(uvGridExponent(1e-30, true), -64)
})

test("drawn texture coordinates take the format's grid, coarser only where the widest page needs it", () => {
  for (const span of [0, -0, -1, NaN]) {
    assert.equal(drawnUvGridExponent(span, false), -14)
    assert.equal(drawnUvGridExponent(span, true), -14)
  }
  assert.equal(drawnUvGridExponent(1, false), -14)
  assert.equal(drawnUvGridExponent(4096, false), -11)
  assert.equal(drawnUvGridExponent(1, true), -23)
  // A blended primitive's grid is the finest its span fits, coarser than the format's if need be.
  assert.equal(drawnUvGridExponent(2 ** 20, true), -3)
  for (let i = 0; i < 10_000; i++) {
    const span = 2 ** (unit() * 60 - 30),
      exponent = drawnUvGridExponent(span, i % 2 === 1)
    assert.ok(span / 2 ** exponent < 2 ** 24, `${span}`)
  }
})

// Behaviour: the logarithms the rules read from the bits (`floorLog2`, `ceilLog2`) are the exact
// integers of the rounded logarithm, from the bits and the bounds of ln 2 (`log2.fixture.ts`), the
// same in every engine, next to every power of two — where a last bit decides the integer, past
// the widest band of 709 doubles: a tile from a scale, rounded down, and the finest grid of a
// span, rounded up.
test('the grids take the integers of the rounded logarithm next to every power of two', () => {
  const view = new DataView(new ArrayBuffer(8))
  const double = (bits: bigint) => (view.setBigUint64(0, bits), view.getFloat64(0))
  const values: number[] = []
  for (let k = -1074; k <= 1023; k += 1) {
    const power = k < -1022 ? 1n << BigInt(k + 1074) : BigInt(k + 1023) << 52n
    for (const d of [0n, 1n, 2n, 708n, 709n, 710n, 711n, 1024n])
      values.push(double(power + d), ...(power > d ? [double(power - d)] : []))
  }
  for (const x of values) {
    assert.equal(tileLog2(x), log2Integers(2 / x)[0], `tile of scale ${x}`)
    const finestOf = Math.min(64, Math.max(-64, log2Integers(x)[1] - 23))
    assert.equal(finest(x), finestOf, `finest grid of span ${x}`)
  }
})
