import test from 'node:test'
import assert from 'node:assert/strict'
import { eachGolden } from '../../../../math/src/golden.fixture.ts'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'
import { primitiveGrids, type GridInputs } from './cutGrid.ts'

// The grid rules of a primitive as the SDK module runs them for the run-time cut, through its one
// export (`page-codec-wasm/src/wasm_grid.rs`, `grid_exponents`), against the exponents the Rust
// rules wrote (`page-codec-wasm/src/golden_tests/grid.rs`). The module measures 32-bit vertices:
// each rule is asked of every span or extent a float holds exactly, as a box from the origin to it;
// the others are the Rust twin's alone.

const exact = (value: number) => value > 0 && Number.isFinite(value) && Math.fround(value) === value

/** The grids of a box from the origin to `extent` along x, its texture coordinates spanning `span`
 *  over its two vertices. */
const grids = (extent: number, span: number, blended: number, inputs?: GridInputs) =>
  primitiveGrids(
    sdkWasm,
    Float32Array.from([0, 0, 0, extent, 0, 0]),
    Float32Array.from([0, 0, span, 0]),
    new Uint32Array(0),
    [],
    blended !== 0,
    inputs,
  )

/** Every case of `name` that `reached` keeps against `compute`, each differing one listed; enough
 *  of them reach the module to hold the rule. */
function assertReached(
  name: string,
  reached: (inputs: number[], output: number) => boolean,
  compute: (inputs: number[], output: number) => number,
) {
  const wrong: string[] = []
  let asked = 0
  eachGolden('grid', name, (inputs, [output], line) => {
    if (!reached(inputs, output)) return
    asked++
    const actual = compute(inputs, output)
    if (actual !== output) wrong.push(`${line} returns ${actual}`)
  })
  assert.deepEqual(wrong, [], `grid ${name}: ${wrong.length} of ${asked} cases differ`)
  assert.ok(asked >= 8, `grid ${name}: ${asked} cases reach the module`)
}

/** A scale of each tile the Rust rule wrote: a position case takes its tile from one. */
const scaleOf = new Map<number, number>()
eachGolden('grid', 'tile_log2', ([has, scale], [tile]) => void (has && scaleOf.set(tile, scale)))

// `finest_exponent` is private to its module, reached through the rule that calls it: a blended
// primitive's position grid is it.
test('the module returns the finest grid of its Rust rule', () => {
  assertReached(
    'finest_exponent',
    ([span]) => exact(span),
    ([span]) => grids(span, 0, 1).positionExponent,
  )
})

// A tile `t` shows through a primitive of extent 2^(t + 7) and no error: that extent capped at the
// tile in 2^16 steps, t - 16, is the finest grid it fits, 2^(t + 7 - 23), so the grid is t - 16.
test('the module returns the tile of its Rust rule', () => {
  assertReached(
    'tile_log2',
    (_, tile) => Math.abs(tile - 16) <= 64 && exact(2 ** (tile + 7)),
    ([has, scale], tile) =>
      grids(2 ** (tile + 7), 0, 0, { finestError: null, scale: has ? scale : null })
        .positionExponent + 16,
  )
})

test('the module returns the position grid of its Rust rule', () => {
  assertReached(
    'primitive_grid_exponent',
    ([extent, , , , tile]) => exact(extent) && scaleOf.has(tile),
    ([extent, hasError, error, blended, tile]) =>
      grids(extent, 0, blended, {
        finestError: hasError ? error : null,
        scale: scaleOf.get(tile)!,
      }).positionExponent,
  )
})

test('the module returns the texture grid of its Rust rule', () => {
  assertReached(
    'uv_grid_exponent',
    ([span]) => exact(span),
    ([span, blended]) => grids(1, span, blended).uvExponent,
  )
})
