import type {
  LampLight,
  Marker,
  Mover,
  Vec3,
} from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import { createClouds, type CloudSettings, type Clouds } from './clouds.ts';
import { daylight, type Daylight } from './daylight.ts';
import { createDome, DISC } from './dome.ts';
import { createEffects, type Effects } from './effects.ts';
import type { SkyEngine, SkyWorld } from './engine.ts';
import { createSkyLights } from './lights.ts';
import { createRain, type Rain } from './rain.ts';
import { hash } from '../../random.ts';
import { createStars } from './stars.ts';
import { moonPhase } from './sun.ts';
import { createWind, type Wind, type WindSettings } from './wind.ts';

/** Visibility in heavy rain, metres (WMO: 1–2 km): where the fog's far end moves as it pours. */
const RAIN_VISIBILITY = 2_000;
/** A sidereal day is 1/365.25 shorter than a solar one: the stars gain a turn a year. */
const SIDEREAL = 366.25 / 365.25;

export type SkyOptions = {
  world: SkyWorld;
  engine: SkyEngine;
  seed: number;
  /** The world's side and one tile's side, metres (`WORLD.size`, `WORLD.tile`). */
  size: number;
  tile: number;
  markers?: readonly Marker[];
  movers?: readonly Mover[];
  /** Where on Earth and when in the year (degrees north, day 1–365). */
  latitude?: number;
  dayOfYear?: number;
  /** Solar time in hours, and game hours per real minute. */
  time?: number;
  speed?: number;
  /** Ångström turbidity of the air: 0.05 clear, 0.1 light haze, 0.3 hazy. */
  haze?: number;
  wind?: Partial<WindSettings>;
  clouds?: Partial<CloudSettings>;
  /** The page's light unit: the key light's intensity for a zenith sun at sea level. */
  sunIntensity?: number;
  stars?: number;
  rainStreaks?: number;
};

export type Sky = {
  /** Solar time, hours in [0, 24); writing it jumps the sky there. */
  time: number;
  /** Game hours per real minute. */
  speed: number;
  /** Stops the day cycle; wind, clouds and effects keep moving. */
  paused: boolean;
  readonly daylight: Daylight;
  readonly isNight: boolean;
  /** 0 by day, 1 at night: what `night: true` lamps and headlights follow. */
  readonly nightFactor: number;
  /** Real seconds since the sky started: the clock the beacons turn by. */
  readonly elapsed: number;
  wind: Wind;
  rain: Rain;
  clouds: Clouds;
  effects: Effects;
  /** A lamp's intensity now: a night lamp fades in with the night, any other stays on. */
  lampIntensity(lamp: LampLight): number;
  /** Advances the sky by `seconds` of real time; `createSky` hooks it on `world.onFrame`. */
  step(seconds: number): void;
};

/**
 * The open world's sky: sun and moon on their true paths for a latitude and a day, an
 * atmosphere that colours the dome, the lights, the fog and the exposure, stars, drifting
 * clouds, wind, rain and every emitter's effect.
 */
export function createSky(options: SkyOptions): Sky {
  const { world, engine, seed, size, tile } = options;
  const sub = (part: number) => Math.floor(hash(seed, part) * 2 ** 32);
  const unit = options.sunIntensity ?? 3;
  const almanac = { latitude: options.latitude ?? 40, dayOfYear: options.dayOfYear ?? 172 };
  const haze = options.haze ?? 0.08;
  const phase = moonPhase(almanac.dayOfYear, hash(seed, 1) * 29.53);
  const camera = world.camera;
  const pixelAngle =
    ((camera.fov ?? 50) * Math.PI) / 180 / Math.max(1, world.canvas?.clientHeight ?? 1000);
  const radius = camera.far * 0.9;
  const dome = createDome(engine, radius, unit);
  const stars = createStars(engine, {
    seed: sub(2),
    count: options.stars ?? 2_000,
    radius: radius * 0.99,
    unit,
    pixelSolidAngle: pixelAngle * pixelAngle,
  });
  const lights = createSkyLights(engine, world, {
    unit,
    shadowReach: tile,
    fogNear: tile,
    fogFar: size,
  });
  // Defaults describe a fair-weather day; the page sets its own weather.
  const wind = createWind(sub(3), {
    speed: 5,
    heading: 0,
    gustiness: 0.4,
    ...options.wind,
  });
  const clouds = createClouds(engine, sub(4), {
    dewSpread: 12,
    cover: 0.35,
    count: 48,
    ...options.clouds,
  });
  const rain = createRain(engine, sub(5), options.rainStreaks ?? 3_000);
  const effects = createEffects(engine, world, {
    seed: sub(6),
    markers: options.markers ?? [],
    movers: options.movers ?? [],
    pixelAngle,
    limit: size,
  });
  world.scene.add(dome.node, stars.node, clouds.node, rain.node, effects.node);

  let painted = Number.NaN;
  let elapsed = 0;
  let day: Daylight;
  const refresh = () => {
    day = daylight({ ...almanac, hours: sky.time, moonPhase: phase, haze });
    dome.paint(day);
    lights.apply(day, dome.horizon);
    painted = sky.time;
  };
  const sky: Sky = {
    time: options.time ?? 18.5,
    speed: options.speed ?? 1,
    paused: false,
    get daylight() {
      return day;
    },
    get isNight() {
      return day.isNight;
    },
    get nightFactor() {
      return day.nightFactor;
    },
    get elapsed() {
      return elapsed;
    },
    wind,
    rain,
    clouds,
    effects,
    lampIntensity: (lamp) => (lamp.night ? lamp.intensity * day.nightFactor : lamp.intensity),
    step(seconds) {
      elapsed += seconds;
      if (!sky.paused) sky.time = (((sky.time + (seconds * sky.speed) / 60) % 24) + 24) % 24;
      // The sky is repainted once the sun has moved by its own diameter: finer steps cannot show.
      const moved = Math.abs(sky.time - painted) * 15 * (Math.PI / 180);
      if (!(moved < 2 * DISC)) refresh();
      const eye = camera.position;
      const at: Vec3 = [eye.x, eye.y, eye.z];
      dome.node.position.set(eye.x, eye.y, eye.z);
      stars.node.position.set(eye.x, eye.y, eye.z);
      stars.update(
        almanac.latitude,
        ((sky.time / 24) * SIDEREAL + almanac.dayOfYear / 365.25) % 1,
        day.nightFactor,
      );
      lights.follow(eye);
      wind.advance(seconds);
      clouds.update(seconds, eye, wind);
      rain.update(seconds, at, wind);
      effects.update(seconds, at, wind, day.nightFactor);
      if (world.scene.fog)
        world.scene.fog.far = size + (RAIN_VISIBILITY - size) * Math.min(1, rain.amount);
      world.exposure = day.exposure;
    },
  };
  refresh();
  world.onFrame(({ delta }) => {
    sky.step(delta);
    world.invalidate();
  });
  return sky;
}
