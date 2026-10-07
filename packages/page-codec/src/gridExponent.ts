/**
 * The position and texture grids of a primitive, the TypeScript twin of the compiler's rules
 * (`packages/page-codec-wasm/src/bits/grid.rs`), term for term: the run-time cut takes them from
 * the SDK module, and from here when that module is not there (`sdk-browser` `cutGrid.ts`). The
 * reasons for each constant are written once, on the Rust side. One rule has no twin: the texture
 * grid of drawn triangles, which only the run-time cut encodes (`drawnUvGridExponent`).
 */
import { UV_EXPONENT } from './geometryPage.ts'
import { MAX_BITS, MAX_EXPONENT } from './pageGrids.ts'

/** A tile spans 2^1 = 2 m of the world. */
const TILE_EXTENT_LOG2 = 1

/** Rust's `as i32` on a float: toward zero, saturated, a NaN zero. */
const asI32 = (x: number) =>
  x !== x ? 0 : Math.trunc(Math.min(2 ** 31 - 1, Math.max(-(2 ** 31), x)))
const clamp = (x: number) => Math.min(MAX_EXPONENT, Math.max(-MAX_EXPONENT, x))

/** `metres` in the object units of a primitive the largest world `scale` places; a missing, zero
 *  or non-finite scale leaves it as is (`object_units`). */
const objectUnits = (metres: number, scale: number | null) =>
  scale !== null && Number.isFinite(scale) && scale > 0 ? metres / scale : metres

/** A tile's width as a power of two in object units, rounded down (`tile_log2`). */
export const tileLog2 = (scale: number | null) =>
  asI32(Math.floor(Math.log2(objectUnits(2 ** TILE_EXTENT_LOG2, scale))))

/** The finest grid on which a positive `span` fits a page's field: at most 2^23 steps
 *  (`finest_exponent`). */
const finestExponent = (span: number) => clamp(asI32(Math.ceil(Math.log2(span))) - (MAX_BITS - 1))

/** The grid of a primitive: its widest extent, capped at its tile, in 2^16 steps, or an eighth of
 *  its DAG's finest error, the finer, never finer than `finestExponent` (`grid_exponent`). */
function gridExponent(extent: number, finestError: number | null, tile: number) {
  const positive = extent > 0,
    widest = positive ? asI32(Math.floor(Math.log2(extent))) : 0,
    finest = positive ? finestExponent(extent) : -(MAX_BITS - 2)
  const byExtent = Math.min(widest, tile) - 16
  const byError = finestError === null ? byExtent : asI32(Math.floor(Math.log2(finestError / 8)))
  return clamp(Math.max(Math.min(byExtent, byError), finest))
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
