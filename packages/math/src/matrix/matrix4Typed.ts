// The matrix product for callers whose buffers are not `Float64Array`: kept apart from
// `matrix4.ts` so that a bundle of the core math does not carry its scratch buffers.
import { copyMatrix4, multiplyMatrix4, type NumberSink } from './matrix4.ts'

const leftOperand = new Float64Array(16),
  rightOperand = new Float64Array(16),
  product = new Float64Array(16)

/**
 * `out = a · b` for any buffer type — a `Float32Array` projection or upload, a host matrix's
 * plain array. The operands are copied into double, `multiplyMatrix4` computes the product and
 * `copyMatrix4` writes it into `out`: one rounding per term, the send conversion
 * `multiplyMatrix4` describes, while its forty-eight sites stay `Float64Array` only. `out` may
 * alias an input.
 */
export function multiplyMatrix4Typed<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  // Three `Float64Array`s go straight to `multiplyMatrix4`: the copies change no bit there. That
  // body reads all of `a` before its first write, so `out` may overlap `a` in any way; it reads
  // each column of `b` only before writing the same column of `out`, so an `out` sharing `b`'s
  // memory (`out === b`, or a view of the same buffer starting a column later) would overwrite
  // columns of `b` not yet read. Hence the guard on the buffer, not on the identity: such a pair
  // takes the copies.
  if (
    out instanceof Float64Array &&
    a instanceof Float64Array &&
    b instanceof Float64Array &&
    out.buffer !== b.buffer
  ) {
    multiplyMatrix4(out, a, b)
    return out
  }
  multiplyMatrix4(product, copyMatrix4(leftOperand, a), copyMatrix4(rightOperand, b))
  return copyMatrix4(out, product)
}
