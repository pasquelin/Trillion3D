/**
 * The position and texture grids of a primitive, the TypeScript twin of the compiler's rules
 * (`packages/page-codec-wasm/src/bits/grid.rs`), term for term: the run-time cut takes them from
 * here (`sdk-browser` `cutGrid.ts`). The reasons for each constant are written once, on the Rust
 * side. One rule has no twin: the texture grid of drawn triangles, which only the run-time cut
 * encodes (`drawnUvGridExponent`).
 */
import { UV_EXPONENT } from './geometryPage.ts'
import { MAX_BITS, MAX_EXPONENT } from './pageGrids.ts'
import { clamp } from '../../math/src/scalar/reals.ts'
import { floorLog2 as integerFloorLog2 } from '../../math/src/scalar/integers.ts'

/** A tile spans 2^1 = 2 m of the world. */
const TILE_EXTENT_LOG2 = 1

/** ⌊2^p · ln 2⌋ for p in 0..=10: how near an integer the logarithm rounds to it (`log2.rs`). */
const LN2_STEPS = [0, 1, 2, 5, 11, 22, 44, 88, 177, 354, 709]
const ln2Steps = (p: number) => LN2_STEPS[p] ?? 0

/** The `p` of the spacing 2^(p-52) of the doubles between `e` and `e + 1` (`spacing`). */
const spacing = (e: number) => integerFloorLog2(e >= 0 ? e : -e - 1)

const bits = new DataView(new ArrayBuffer(8))

/** `x = 2^e · (1 + f · 2^-52)` for a positive finite `x`, a subnormal scaled by 2^64 first
 *  (`split`). */
function split(x: number): [e: number, f: number] {
  const subnormal = x < 2 ** -1022
  bits.setFloat64(0, subnormal ? x * 2 ** 64 : x)
  const high = bits.getUint32(0)
  return [
    (high >>> 20) - 1023 - (subnormal ? 64 : 0),
    (high & 0xfffff) * 2 ** 32 + bits.getUint32(4),
  ]
}

/** What Rust's cast of a logarithm gives for a value with no finite logarithm, or null. */
const special = (x: number) =>
  x !== x || x < 0 ? 0 : x === 0 ? -(2 ** 31) : x === Infinity ? 2 ** 31 - 1 : null

/** `floor(log2 x)` from the bits of `x`, the integer of the logarithm rounded to the nearest
 *  double, the same on every host (`floor_log2`). */
function floorLog2(x: number): number {
  const cast = special(x)
  if (cast !== null) return cast
  const [e, f] = split(x)
  return e + Number(2 ** 52 - f <= ln2Steps(spacing(e)))
}

/** `ceil(log2 x)` from the bits of `x`, as `floorLog2` (`ceil_log2`). */
function ceilLog2(x: number): number {
  const cast = special(x)
  if (cast !== null) return cast
  const [e, f] = split(x)
  return f === 0 ? e : e + 1 - Number(f <= ln2Steps(spacing(e) - 1))
}

/** `metres` in the object units of a primitive the largest world `scale` places; a missing, zero
 *  or non-finite scale leaves it as is (`object_units`). */
const objectUnits = (metres: number, scale: number | null) =>
  scale !== null && Number.isFinite(scale) && scale > 0 ? metres / scale : metres

/** A tile's width as a power of two in object units, rounded down (`tile_log2`). */
export const tileLog2 = (scale: number | null) =>
  floorLog2(objectUnits(2 ** TILE_EXTENT_LOG2, scale))

/** The finest grid on which a positive `span` fits a page's field: at most 2^23 steps; a NaN or
 *  a negative span 2^-23, a zero the finest grid, an infinite one the coarsest
 *  (`finest_exponent`). */
const finestExponent = (span: number) =>
  clamp(ceilLog2(span) - (MAX_BITS - 1), -MAX_EXPONENT, MAX_EXPONENT)

/** The grid of a primitive: its widest extent, capped at its tile, in 2^16 steps, or an eighth of
 *  its DAG's finest error, the finer, never finer than `finestExponent` (`grid_exponent`). */
function gridExponent(extent: number, finestError: number | null, tile: number) {
  const positive = extent > 0,
    widest = positive ? floorLog2(extent) : 0,
    finest = positive ? finestExponent(extent) : -(MAX_BITS - 2)
  const byExtent = Math.min(widest, tile) - 16
  const byError = finestError === null ? byExtent : floorLog2(finestError / 8)
  return clamp(Math.max(Math.min(byExtent, byError), finest), -MAX_EXPONENT, MAX_EXPONENT)
}

/** A `blended` primitive's grid is the finest its pages hold; any other's `gridExponent`
 *  (`primitive_grid_exponent`). */
export const primitiveGridExponent = (
  extent: number,
  finestError: number | null,
  blended: boolean,
  tile: number,
) => (blended && extent > 0 ? finestExponent(extent) : gridExponent(extent, finestError, tile))

/** The texture grid of a primitive whose texture coordinates span `span`: the format's, or for a
 *  `blended` one the finest that span fits, never coarser (`uv_grid_exponent`). */
export const uvGridExponent = (span: number, blended: boolean) =>
  blended && span > 0 ? Math.min(finestExponent(span), UV_EXPONENT) : UV_EXPONENT

/** The texture grid of drawn triangles, whose widest page's coordinates span `span`: the run-time
 *  cut's rule alone, no compiled primitive takes it. A `blended` primitive takes the finest grid
 *  that span fits; any other the format's, coarser only where the span would not fit a page's
 *  field; no span, the format's. */
export const drawnUvGridExponent = (span: number, blended: boolean) =>
  span > 0
    ? blended
      ? finestExponent(span)
      : Math.max(UV_EXPONENT, finestExponent(span))
    : UV_EXPONENT
