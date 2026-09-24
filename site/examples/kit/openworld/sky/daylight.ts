import {
  discVisible,
  exposureFor,
  luminance,
  nightFactor,
  scale,
  skyIrradiance,
  skyRadiance,
  transmittance,
} from './atmosphere.ts';
import type { Rgb } from './engine.ts';
import { elevation, moonDirection, moonLit, sunDirection, type Almanac } from './sun.ts';

/** Full-moon illuminance over the sun's, both at the top of the air (0.32 lx / 128 klx). */
const FULL_MOON = 0.32 / 128_000;
/** Starlight and airglow on a moonless night over the sun's (about 0.002 lx / 128 klx). */
const NIGHT_GLOW = 0.002 / 128_000;
/** Mean albedo of land: what the ground sends back up to fill shadows from below. */
const GROUND_ALBEDO = 0.2;

/** The sky's conditions: where and when, and how hazy the air is (Ångström turbidity). */
export type Conditions = Almanac & { hours: number; moonPhase: number; haze: number };

/** Everything the lights, the dome and the exposure read of one moment. Illuminances are
 *  relative to a zenith sun at sea level in the same air (1 at noon on the equator). */
export type Daylight = {
  sun: Rgb;
  moon: Rgb;
  moonLit: number;
  sunElevation: number;
  nightFactor: number;
  isNight: boolean;
  /** The one shadow-casting light: the sun by day, the moon when it outshines the sun. */
  key: { direction: Rgb; colour: Rgb; illuminance: number };
  /** The sky's light on a horizontal surface, and the ground's from below. */
  fill: { sky: Rgb; ground: Rgb };
  exposure: number;
  /** Sky radiance along unit `view`, relative like the illuminances (sr⁻¹). */
  radiance(view: Rgb): Rgb;
};

const add = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The light arriving from a body at the top-of-air illuminance `strength`, per channel. */
function direct(direction: Rgb, strength: number, haze: number): Rgb {
  const h = elevation(direction);
  return scale(transmittance(h, haze), strength * discVisible(h));
}

/** The sky at one moment, computed from the sun's and moon's positions through the air. */
export function daylight(conditions: Conditions): Daylight {
  const { hours, moonPhase, haze } = conditions;
  const sun = sunDirection(conditions, hours);
  const moon = moonDirection(conditions, hours, moonPhase);
  const lit = moonLit(moonPhase);
  const noon = luminance(transmittance(Math.PI / 2, haze));
  const sunLight = direct(sun, 1 / noon, haze);
  const moonLight = direct(moon, (FULL_MOON * lit) / noon, haze);
  const sunKey = luminance(sunLight) >= luminance(moonLight);
  const keyLight = sunKey ? sunLight : moonLight;
  const glow: Rgb = [NIGHT_GLOW, NIGHT_GLOW, NIGHT_GLOW];
  const moonSky = scale(skyIrradiance(moon, haze), (FULL_MOON * lit) / noon);
  const sky = add(add(scale(skyIrradiance(sun, haze), 1 / noon), moonSky), glow);
  const horizontal = add(
    add(scale(sunLight, Math.max(0, sun[1])), scale(moonLight, Math.max(0, moon[1]))),
    sky,
  );
  const sunElevation = elevation(sun);
  const night = nightFactor(sunElevation);
  const peak = Math.max(keyLight[0], keyLight[1], keyLight[2]);
  return {
    sun,
    moon,
    moonLit: lit,
    sunElevation,
    nightFactor: night,
    isNight: night >= 0.5,
    key: {
      direction: sunKey ? sun : moon,
      colour: peak > 0 ? scale(keyLight, 1 / peak) : [1, 1, 1],
      illuminance: luminance(keyLight),
    },
    fill: { sky, ground: scale(horizontal, GROUND_ALBEDO) },
    exposure: exposureFor(luminance(horizontal), 1),
    radiance: (view) =>
      add(
        add(
          scale(skyRadiance(view, sun, haze), 1 / noon),
          scale(skyRadiance(view, moon, haze), (FULL_MOON * lit) / noon),
        ),
        scale(glow, 1 / Math.PI),
      ),
  };
}
