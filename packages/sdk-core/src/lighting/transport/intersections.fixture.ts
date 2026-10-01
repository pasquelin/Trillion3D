/** The binary64 values next to `value`, `steps` apart at most on either side. */
export function* neighbours(value: number, steps: number) {
  const word = new Float64Array([value]),
    bits = new BigInt64Array(word.buffer);
  const start = bits[0];
  for (let k = -steps; k <= steps; k++) {
    bits[0] = start + BigInt(k);
    yield word[0];
  }
}
