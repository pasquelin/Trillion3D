/**
 * KHR_materials_volume's Beer–Lambert law, one for the water's colour and for the shadow it casts:
 * light crossing a path `x` of a volume keeps `T = c^(x / d)` of itself, `c` its attenuation colour
 * clamped to [0, 1] and `d` its attenuation distance; a distance that is not positive declares no
 * volume (`T = 1`), an infinite one absorbs nothing, and a black channel absorbs all the light of
 * any path that is not zero (glTF KHR_materials_volume, "Attenuation"). The water clamped its colour
 * to 10⁻⁵ — a black volume let through half its light within d / 16.6 — and the shadow took
 * `pow(0, y)`, which WGSL leaves undefined.
 *
 * Each in its most exact form. The water's record holds the volume's constant `k = log2(c) / d`,
 * computed once in f64 (`volumeAttenuation`), and a pixel takes `2^(k·x)` (`volumeTransmittance`).
 * The shadow's raster reads a page's colour and distance per fragment and takes `c^(x / d)` itself
 * (`volumeTransmittanceOf`): the per-fragment `k` would round once more.
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

/** The law in WGSL: the water's transmittance from its constant, the shadow's from its colour. */
export const VOLUME_LAW_WGSL = `
fn volumeTransmittance(k:vec3f,path:f32)->vec3f{return exp2(k*path);}
fn volumeTransmittanceOf(colour:vec3f,distance:f32,path:f32)->vec3f{
 if(!(distance>0.0)){return vec3f(1.0);}
 let c=min(colour,vec3f(1.0));
 return select(vec3f(select(1.0,0.0,path!=0.0)),pow(c,vec3f(path/distance)),c>vec3f(0.0));
}`
