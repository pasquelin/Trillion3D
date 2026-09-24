import type { Rgb } from './engine.ts';

/**
 * A one-layer atmosphere, single scattering, computed per colour channel at one wavelength
 * each. Air scatters as Rayleigh (Hansen & Travis 1974 optical depth), haze as Ångström's law
 * with a Henyey–Greenstein phase; path lengths are Kasten & Young's (1989) air mass. Nothing
 * here is a colour table: every colour of the sky, the sun and the fog comes from these laws.
 * Multiple scattering is left out, so the sky reads a little darker than a real one.
 */

/** The wavelength each channel stands for, micrometres (red, green, blue). */
const WAVELENGTHS: Rgb = [0.68, 0.55, 0.44];
/** Relative luminance of linear sRGB primaries (ITU-R BT.709). */
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
/** Ångström's wavelength exponent for continental aerosol. */
const ANGSTROM_ALPHA = 1.3;
/** Henyey–Greenstein asymmetry of haze: strongly forward, the glow around the sun. */
const HAZE_G = 0.76;
/** Earth's radius and the air's scale height, metres: how fast Earth's shadow climbs at dusk. */
const EARTH_RADIUS = 6_371_000;
const AIR_SCALE_HEIGHT = 8_000;
const DEG = Math.PI / 180;
/** Refraction at the horizon and the sun's angular radius, radians: when the disc sets. */
const REFRACTION = 0.567 * DEG;
const DISC_RADIUS = 0.266 * DEG;
/** Civil twilight ends with the sun 6° below the horizon: outdoor lighting is then needed. */
const CIVIL_DUSK = -6 * DEG;
/** Stevens' (1957) exponent for perceived brightness: the eye adapts, but not all the way. */
const BRIGHTNESS_EXPONENT = 1 / 3;

const map = (f: (channel: number) => number): Rgb => [f(0), f(1), f(2)];
/** `c` times `k`, channel by channel. */
export const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
export const luminance = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** Rayleigh optical depth of the whole air column at `lambda` micrometres. */
const rayleighDepth = (lambda: number) =>
  0.008569 * lambda ** -4 * (1 + 0.0113 * lambda ** -2 + 0.00013 * lambda ** -4);

/** The column's optical depths per channel, air and haze, for Ångström turbidity `haze`. */
function depths(haze: number): { air: Rgb; haze: Rgb } {
  return {
    air: map((c) => rayleighDepth(WAVELENGTHS[c])),
    haze: map((c) => haze * WAVELENGTHS[c] ** -ANGSTROM_ALPHA),
  };
}

/** Relative air mass along a ray at elevation `h` (radians); rays below the horizon graze it. */
function airmass(h: number): number {
  const degrees = Math.max(0, h / DEG);
  return 1 / (Math.sin(degrees * DEG) + 0.50572 * (degrees + 6.07995) ** -1.6364);
}

/** The fraction of light at the top of the air that reaches the ground from elevation `h`. */
export function transmittance(h: number, haze: number): Rgb {
  const { air, haze: aerosol } = depths(haze);
  const m = airmass(h);
  return map((c) => Math.exp(-(air[c] + aerosol[c]) * m));
}

/** How much of the disc stands above the horizon, 0–1, for a centre at elevation `h`. */
export function discVisible(h: number): number {
  const t = (h + REFRACTION + DISC_RADIUS) / (2 * DISC_RADIUS);
  return Math.max(0, Math.min(1, t));
}

/**
 * The share of the air above the observer still in sunlight once the sun is `-h` below the
 * horizon: Earth's shadow stands `R (1 / cos d − 1)` above, and the air thins as e^(−z/H).
 */
export function twilight(h: number): number {
  if (h >= 0) return 1;
  return Math.exp(-(EARTH_RADIUS * (1 / Math.cos(-h) - 1)) / AIR_SCALE_HEIGHT);
}

const rayleighPhase = (cos: number) => (3 / (16 * Math.PI)) * (1 + cos * cos);
const hazePhase = (cos: number) =>
  (1 - HAZE_G * HAZE_G) / (4 * Math.PI * (1 + HAZE_G * HAZE_G - 2 * HAZE_G * cos) ** 1.5);

/**
 * Sky radiance seen along unit `view`, per unit illuminance of a source along unit `source` at
 * the top of the air (sr⁻¹): light scattered once towards the eye along the view's path. The
 * air scatters at every height, so the source's light reaching it is the column average of
 * e^(−τ m e^(−z/H)), which is (1 − e^(−τm)) / τm. A source below the horizon lights only the
 * air above Earth's shadow.
 */
export function skyRadiance(view: Rgb, source: Rgb, haze: number): Rgb {
  const { air, haze: aerosol } = depths(haze);
  const hs = Math.asin(source[1]);
  const ms = airmass(hs);
  const mv = airmass(Math.asin(Math.max(0, view[1])));
  const cos = view[0] * source[0] + view[1] * source[1] + view[2] * source[2];
  const lit = twilight(hs);
  return map((c) => {
    const tau = air[c] + aerosol[c];
    const phase = (air[c] * rayleighPhase(cos) + aerosol[c] * hazePhase(cos)) / tau;
    const reach = (1 - Math.exp(-tau * ms)) / (tau * ms);
    return lit * reach * (1 - Math.exp(-tau * mv)) * phase;
  });
}

/**
 * The irradiance a horizontal surface receives from the whole sky, per unit source illuminance:
 * the radiance summed over the upper hemisphere, cosine-weighted (6 rings × 12 azimuths).
 */
export function skyIrradiance(source: Rgb, haze: number): Rgb {
  const sum = [0, 0, 0];
  const rings = 6;
  const around = 12;
  for (let ring = 0; ring < rings; ring++) {
    const h = ((ring + 0.5) / rings) * (Math.PI / 2);
    const weight = Math.cos(h) * Math.sin(h) * (Math.PI / 2 / rings) * ((2 * Math.PI) / around);
    for (let step = 0; step < around; step++) {
      const a = (step / around) * 2 * Math.PI;
      const view: Rgb = [Math.cos(h) * Math.cos(a), Math.sin(h), Math.cos(h) * Math.sin(a)];
      const radiance = skyRadiance(view, source, haze);
      for (let c = 0; c < 3; c++) sum[c] += radiance[c] * weight;
    }
  }
  return [sum[0], sum[1], sum[2]];
}

/** 0 by day, 1 once civil twilight is over: rises from sunset to the end of civil dusk. */
export function nightFactor(sunElevation: number): number {
  const t = (-REFRACTION - DISC_RADIUS - sunElevation) / (-REFRACTION - DISC_RADIUS - CIVIL_DUSK);
  const s = Math.max(0, Math.min(1, t));
  return s * s * (3 - 2 * s);
}

/**
 * The exposure an adapting eye gives a scene lit by `illuminance`, relative to `reference`
 * (noon): displayed brightness follows illuminance to Stevens' power, so dusk reads darker
 * than noon but a moonlit field still shows.
 */
export function exposureFor(illuminance: number, reference: number): number {
  return (reference / Math.max(illuminance, reference * 1e-9)) ** (1 - BRIGHTNESS_EXPONENT);
}

/** A colour scaled so its brightest channel is 1, and that channel's value. */
export function normalise(colour: Rgb): { colour: Rgb; peak: number } {
  const peak = Math.max(colour[0], colour[1], colour[2]);
  if (peak <= 0) return { colour: [0, 0, 0], peak: 0 };
  return { colour: map((c) => colour[c] / peak), peak };
}
