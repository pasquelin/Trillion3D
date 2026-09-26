/**
 * The alpha of the leaf `site/examples/leaves-cut-by-alpha.html` draws (`leafTexture`), byte for
 * byte, row by row: a pointed blade, its edge a ramp six texels wide at 256². The example builds its
 * own; the tests take this one, and the two formulas stay one line apart.
 */
export function leafAlpha(size = 256) {
  const alpha = new Uint8Array(size * size);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const along = py / size,
        across = Math.abs(px / size - 0.5);
      const width = 0.42 * Math.sin(Math.PI * along) ** 0.8;
      alpha[py * size + px] = Math.round(
        Math.min(1, Math.max(0, (width - across) * 40 + 0.5)) * 255,
      );
    }
  return alpha;
}
