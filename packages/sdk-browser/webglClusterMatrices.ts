export function multiplyMatrix4(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let k = 0; k < 4; k++) value += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = value;
    }
  return out;
}
