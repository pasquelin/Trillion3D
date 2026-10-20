// The sampler's bilinear read on the processor, for the oracles of the shaders that sample: the
// four texels around a point, their indices clamped to the edge, weighed by the point's fractions.

/** The bilinear read at texel coordinates `(x, y)` of a `w` × `h` grid whose texel `(i, j)` is
 *  `texel(i, j)`, clamped to the edge as the samplers read; with `weightBits`, the sampler's own
 *  rounding: each weight's fraction held to that many bits. */
export function bilinearRead(
  texel: (i: number, j: number) => number,
  w: number,
  h: number,
  x: number,
  y: number,
  weightBits?: number,
) {
  const fx = x - 0.5,
    fy = y - 0.5
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy)
  const held = (t: number) => (weightBits ? Math.round(t * 2 ** weightBits) / 2 ** weightBits : t)
  const tx = held(fx - x0),
    ty = held(fy - y0)
  const at = (i: number, j: number) =>
    texel(Math.min(w - 1, Math.max(0, i)), Math.min(h - 1, Math.max(0, j)))
  return (
    (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
    (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
  )
}
