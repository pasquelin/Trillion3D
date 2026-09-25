// The matrix product for callers whose buffers are not `Float64Array`: kept apart from
// `matrix4.ts` so that a bundle of the core math does not carry its scratch buffers.
import { copyMatrix4, multiplyMatrix4, type NumberSink } from './matrix4.ts';

const leftOperand = new Float64Array(16),
  rightOperand = new Float64Array(16),
  product = new Float64Array(16);

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
  multiplyMatrix4(product, copyMatrix4(leftOperand, a), copyMatrix4(rightOperand, b));
  return copyMatrix4(out, product);
}
