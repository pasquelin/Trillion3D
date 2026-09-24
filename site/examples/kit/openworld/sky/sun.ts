import type { Rgb } from './engine.ts';

/** Earth's axial tilt, degrees: the amplitude of the sun's declination over a year. */
const OBLIQUITY = 23.44;
/** Days from the December solstice to 1 January, the phase of the declination's cosine. */
const SOLSTICE_OFFSET = 10;
/** Mean length of a lunar cycle, days (new moon to new moon). */
const SYNODIC_MONTH = 29.530589;
const DEG = Math.PI / 180;

/** Where on Earth and when in the year the world stands. */
export type Almanac = { latitude: number; dayOfYear: number };

/**
 * The sun's declination, radians, on `day` (1–365): the tilt of Earth's axis seen from the sun,
 * the usual cosine approximation (within about one degree of the ephemeris).
 */
function declination(day: number): number {
  return -OBLIQUITY * DEG * Math.cos(((2 * Math.PI) / 365) * (day + SOLSTICE_OFFSET));
}

/**
 * A unit vector pointing from the ground to a body of declination `delta` (radians) at hour
 * angle `hourAngle` (radians, 0 when it crosses the meridian), seen from `latitude` (degrees),
 * in the world's frame: +X east, +Y up, +Z south.
 */
function towards(latitude: number, delta: number, hourAngle: number): Rgb {
  const phi = latitude * DEG;
  const east = -Math.cos(delta) * Math.sin(hourAngle);
  const north =
    Math.sin(delta) * Math.cos(phi) - Math.cos(delta) * Math.cos(hourAngle) * Math.sin(phi);
  const up =
    Math.sin(delta) * Math.sin(phi) + Math.cos(delta) * Math.cos(hourAngle) * Math.cos(phi);
  return [east, up, -north];
}

/** The hour angle of local solar time `hours` (0–24): 15° per hour from noon. */
const hourAngle = (hours: number) => (hours - 12) * 15 * DEG;

/** The direction to the sun at solar time `hours` on the almanac's day. */
export function sunDirection(almanac: Almanac, hours: number): Rgb {
  return towards(almanac.latitude, declination(almanac.dayOfYear), hourAngle(hours));
}

/** Elevation above the horizon, radians, of a unit direction. */
export const elevation = (direction: Rgb) => Math.asin(Math.max(-1, Math.min(1, direction[1])));

/**
 * The moon's phase on `day`, in [0, 1): 0 new, 0.5 full. `offset` (days) places the world's
 * first new moon, so two seeds see two different months.
 */
export function moonPhase(day: number, offset: number): number {
  const cycles = (day + offset) / SYNODIC_MONTH;
  return cycles - Math.floor(cycles);
}

/** The lit fraction of the moon's disc at `phase`: 0 new, 1 full. */
export const moonLit = (phase: number) => (1 - Math.cos(2 * Math.PI * phase)) / 2;

/**
 * The direction to the moon: it trails the sun by `phase` of a day, and its declination swings
 * to the opposite of the sun's at full moon, since it then stands on the far side of Earth
 * (orbit inclination to the ecliptic, 5°, left out).
 */
export function moonDirection(almanac: Almanac, hours: number, phase: number): Rgb {
  const delta = declination(almanac.dayOfYear) * Math.cos(2 * Math.PI * phase);
  return towards(almanac.latitude, delta, hourAngle(hours - phase * 24));
}
