/**
 * THE WORLD SPHERE OF A ROW, one formula for the GPU that writes it (`gpuComposeWgsl.ts`,
 * `composeSphere`) and the CPU that reads it where a shadow's change box is declared
 * (`../webgpu/shadow/spheres.ts`). A row's local box has a centre `c` and half extents `h` (the
 * reach in). Its world image is a parallelepiped about `W·c + t`; its farthest corner lies at
 * `max |W·(s∘h)|` over the signs `s`, the columns of `W` scaled by `h` summed with signs. A sphere
 * of that radius holds every point of the box, so every vertex of the page: it is a bound by
 * construction, the tightest sphere about that centre, and never wider than the sphere about the
 * world box of the same box (which is `|W|·h` long, `√3` times larger at worst).
 *
 * The radius is evaluated in single precision, and the rounding of every operation is covered:
 * each component of a corner offset errs by at most `2⁻²³` of the sum of the magnitudes of its three
 * terms, so the radius is grown by `2⁻²⁰` of the norm of those sums (`SPHERE_MARGIN`), and by
 * `2⁻²¹` of itself for the squares, the sums and the root (`SPHERE_GROWTH`); the centre, a double
 * sum split into two singles, errs by less than `2⁻⁴⁸` of the magnitudes of its terms, below the
 * `2⁻⁴⁴` of them that is added. The order of the single-precision operations is the shader's.
 */
export const SPHERE_GROWTH = 1 + 2 ** -21
export const SPHERE_MARGIN = 2 ** -20
export const CENTRE_ERROR = 2 ** -44

const f = Math.fround
const m = new Float32Array(9)

/** The sphere's radius for the world `w` (column-major, sixteen), the local box's centre `c` and
 *  half extent `h`, the shader's single-precision arithmetic step for step. */
export function sphereRadius(w: ArrayLike<number>, c: ArrayLike<number>, h: ArrayLike<number>) {
  let size = 0,
    sums = 0
  for (let i = 0; i < 3; i++) {
    let l1 = 0
    for (let j = 0; j < 3; j++) {
      const e = Math.abs(f(w[j * 4 + i]))
      m[i * 3 + j] = f(f(w[j * 4 + i]) * f(h[j]))
      size = f(size + f(e * Math.abs(f(c[j]))))
      l1 = f(l1 + Math.abs(m[i * 3 + j]))
    }
    size = f(size + Math.abs(f(w[12 + i])))
    sums = f(sums + f(l1 * l1))
  }
  let r2 = 0
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    let norm = 0
    for (let i = 0; i < 3; i++) {
      const x = f(f(m[i * 3] + f(a * m[i * 3 + 1])) + f(b * m[i * 3 + 2]))
      norm = f(norm + f(x * x))
    }
    r2 = Math.max(r2, norm)
  }
  const grown = f(f(Math.sqrt(r2)) * SPHERE_GROWTH),
    margin = f(f(Math.sqrt(sums)) * SPHERE_MARGIN)
  return f(f(grown + margin) + f(size * CENTRE_ERROR))
}
