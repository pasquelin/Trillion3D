/**
 * KHR_materials_volume's Beer–Lambert law, the water's colour: light crossing a path `x` of a volume keeps `T = c^(x / d)` of itself, `c` its attenuation colour
 * clamped to [0, 1] and `d` its attenuation distance; a distance that is not positive declares no
 * volume (`T = 1`), an infinite one absorbs nothing, and a black channel absorbs all the light of
 * any path that is not zero (glTF KHR_materials_volume, "Attenuation"). The water clamped its colour
 * to 10⁻⁵ — a black volume let through half its light within d / 16.6.
 *
 * One form, its most exact one: a surface's record holds the volume's constant `k = log2(c) / d`,
 * computed once in f64 (`volumeAttenuation`, `../../materials/table/materialRecord.ts`), and a pixel
 * takes `2^(k·x)` — one rounding of
 * `k`, against the `log2` and the division a per-fragment `c^(x / d)` rounds each time. A volume
 * that absorbs nothing — no distance, or a white colour — holds `k = 0`, which lets all through.
 */
/** A black channel's `k`: `2^(k·x)` is 0 past a path of 10⁻¹⁹, and 1 at a path of 0. */
const VOLUME_BLACK_LOG2 = -(2 ** 64)

/** `k` of each channel of `colour` over `distance`, into `out`. */
export function volumeAttenuation(
  colour: ArrayLike<number>,
  distance: number,
  out: number[] = [0, 0, 0],
) {
  for (let i = 0; i < 3; i++) {
    const c = Math.min(colour[i], 1)
    out[i] = !(distance > 0) ? 0 : c > 0 ? Math.log2(c) / distance : VOLUME_BLACK_LOG2
  }
  return out
}
