import { reserveArena } from '../../wasm/wasmArena.ts'
import type { SdkWasm } from '../../wasm/sdkWasm.ts'

/** What the compiler knew of a primitive beside its vertices, which sets its grids: the finest
 *  error its DAG published and the largest world scale that places it, each null when unknown. A
 *  world's drawn triangles have neither — no DAG, a metre per unit —; a compiled primitive cut
 *  again in session both. */
export type GridInputs = { finestError: number | null; scale: number | null }

const DRAWN: GridInputs = { finestError: null, scale: null }

/**
 * The position and texture grid exponents of a primitive the engine cuts at run time: the
 * compiler's own measures and rules (`packages/page-codec-wasm/src/bits/grid.rs`), run in the SDK
 * module that encodes the page (`wasm/grid.rs`, `grid_exponents`), the same integers on every
 * host — a kilometre primitive on its tiled grid, a `blended` one on the finest —: a page cut here
 * is the one the compiler writes. The extent is the box of every vertex of `positions`; the
 * texture span the widest of `uvs` over the corners of each of `ranges` (into `indices`), or over
 * every vertex when `ranges` is empty — a compiled primitive cut again, whose pages may hold it
 * whole.
 */
export function primitiveGrids(
  module: SdkWasm,
  positions: Float32Array,
  uvs: Float32Array | null,
  indices: Uint32Array,
  ranges: readonly (readonly [number, number])[],
  blended: boolean,
  { finestError, scale }: GridInputs = DRAWN,
) {
  const input = reserveArena(module, [
    { type: 'f32', length: Math.max(1, positions.length) },
    { type: 'f32', length: Math.max(1, uvs?.length ?? 0) },
    { type: 'u32', length: Math.max(1, ranges.length ? indices.length : 0) },
    { type: 'u32', length: Math.max(1, ranges.length * 2) },
    { type: 'u32', length: 2 },
  ])
  if (!input) throw new Error('GRID_MEMORY')
  try {
    const [position, uv, index, range, out] = input.blocks()
    position.view.set(positions)
    if (uvs) uv.view.set(uvs)
    if (ranges.length) index.view.set(indices)
    for (let k = 0; k < ranges.length; k++) {
      range.view[k * 2] = ranges[k][0]
      range.view[k * 2 + 1] = ranges[k][1]
    }
    module.grid_exponents(
      ...[position.offset, positions.length / 3, uvs ? uv.offset : 0, index.offset],
      ...[range.offset, ranges.length, Number(blended), finestError ?? NaN, scale ?? NaN],
      out.offset,
    )
    // Two signed words, read on views the call's growth may have rebuilt: the views are unsigned.
    const [positionExponent, uvExponent] = input.blocks()[4].view
    return { positionExponent: positionExponent | 0, uvExponent: uvExponent | 0 }
  } finally {
    input.freed()
  }
}
