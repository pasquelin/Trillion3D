/** The PCF's taps, in texels around the read point: the filtered read of a blended surface and of
 *  the water (`shadowWgsl.ts`, `vsmFilterTaps`). Each lies within a texel of the read point on
 *  either axis, so the bilinear footprints of all sixteen hold the 4 × 4 texels around it.
 *
 *  Four taps and their quarter turns, the texel grid's own symmetry: both axes and both senses of
 *  the map weigh alike, and the taps' mean is the read point, so no edge is shifted. Tap k of the
 *  four is a spiral point of the disk through the square's corners (radius √2): at radius
 *  √2 · √((k + ½) / 4), each an equal share of its area, and at angle π/4 + k·γ/4, γ = π(3 − √5)
 *  the golden angle, whose quarter spreads the angles most evenly over a quarter turn. A tap past
 *  the square is brought back along its ray onto its edge. Sixteen, four turns of four: as many as
 *  the texels the read compares. The start on a diagonal is the one value not derived: from an
 *  axis the two closest taps are 0.38 texel apart, from the diagonal 0.49. Each at f32, the
 *  shader's precision. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const taps: [number, number][] = [];
for (let k = 0; k < 4; k++) {
  const radius = Math.SQRT2 * Math.sqrt((k + 0.5) / 4);
  const angle = Math.PI / 4 + (k * GOLDEN_ANGLE) / 4;
  const [x, y] = [radius * Math.cos(angle), radius * Math.sin(angle)];
  const past = Math.max(Math.abs(x), Math.abs(y), 1);
  let tap: [number, number] = [Math.fround(x / past), Math.fround(y / past)];
  for (let turn = 0; turn < 4; turn++) {
    taps.push(tap);
    tap = [-tap[1], tap[0]];
  }
}

/** The sixteen taps, read-only: every composed shader prints them. */
export const PCF_TAPS: readonly (readonly [number, number])[] = Object.freeze(
  taps.map((tap) => Object.freeze(tap)),
);
