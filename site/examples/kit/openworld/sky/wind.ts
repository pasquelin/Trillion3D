import { noise1 } from './random.ts';

/** Hellmann's exponent for open land: wind speed grows as height^(1/7) above the ground. */
const HELLMANN = 1 / 7;
/** Height at which a wind is reported, metres (the WMO's standard anemometer height). */
const REFERENCE_HEIGHT = 10;

/** The wind the page sets, as a weather report gives it. */
export type WindSettings = {
  /** Mean speed at 10 m, metres per second. */
  speed: number;
  /** Where the wind blows towards, radians from +X towards +Z. */
  heading: number;
  /** Gust factor: peak gust over mean speed minus one (0.3–0.5 over open land). */
  gustiness: number;
};

/** The wind every effect shares: a mean vector, gusts and the change of speed with height. */
export type Wind = WindSettings & {
  /** Moves the wind's own clock by `seconds` of game time. */
  advance(seconds: number): void;
  /** The horizontal wind at `height` metres above the ground now, metres per second. */
  at(height: number): { x: number; z: number };
};

/**
 * A wind with seeded gusts: speed and heading wander along smooth noise, the speed by up to
 * `gustiness`, the heading by the angle a gust of that size turns a mean flow.
 */
export function createWind(seed: number, settings: WindSettings): Wind {
  let time = 0;
  const wind: Wind = {
    ...settings,
    advance(seconds) {
      time += seconds;
    },
    at(height) {
      // A gust lasts tens of seconds; the noise runs one step per ten seconds of game time.
      const gust = 1 + wind.gustiness * noise1(seed, time / 10);
      const veer = Math.atan(wind.gustiness) * noise1(seed + 1, time / 10);
      const profile = (Math.max(height, 1) / REFERENCE_HEIGHT) ** HELLMANN;
      const speed = wind.speed * Math.max(0, gust) * profile;
      return {
        x: Math.cos(wind.heading + veer) * speed,
        z: Math.sin(wind.heading + veer) * speed,
      };
    },
  };
  return wind;
}
