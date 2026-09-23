import type { EffectKind } from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import type { Motion } from './pool.ts';

const G = 9.81;

/**
 * How one effect looks and moves. Speeds, response times and lifetimes are the phenomenon's
 * own orders of magnitude, so they hold wherever a region places the emitter; the emitter's
 * radius sets where particles start.
 */
export type Preset = {
  motion: Motion;
  /** Particles per second per emitter. */
  rate: number;
  /** Seconds a particle lives. */
  life: number;
  /** Launch speed, m/s, and which way: up, outwards, or along the emitter's heading. */
  speed: number;
  launch: 'up' | 'out' | 'ahead';
  /** Cone half-angle around the launch direction, radians. */
  spread: number;
  /** Vertical acceleration, m/s², and response time to the air, s (0: not blown). */
  lift: number;
  response: number;
  /** Point size, metres, and look. */
  size: number;
  colour: string;
  opacity: number;
  additive: boolean;
  /** Most live particles of this kind at once. */
  capacity: number;
  /** Shown only at night (fireflies) or only by day (birds). */
  when?: 'night' | 'day';
  /** Circling or wandering radius (metres) and rate (rad/s) for orbit and wander motions. */
  orbit?: { radius: number; rate: number };
};

/** Particle effects by emitter kind; `heat-haze`, `neon-glow` and the beam are not particles. */
export type ParticleKind = Exclude<EffectKind, 'heat-haze' | 'neon-glow' | 'lighthouse-beam'>;

/** One ballistic preset from its columns, in the order of `Preset`'s fields. */
const row = (
  rate: number,
  life: number,
  speed: number,
  launch: Preset['launch'],
  spread: number,
  lift: number,
  response: number,
  size: number,
  colour: string,
  opacity: number,
  capacity: number,
): Preset => ({
  motion: 'ballistic',
  rate,
  life,
  speed,
  launch,
  spread,
  lift,
  response,
  size,
  colour,
  opacity,
  additive: false,
  capacity,
});

/**
 * Response times are terminal fall speed over g (τ = v_t / g): a particle falls at `g τ` and
 * follows the wind after about `τ`. Sand grains (0.2 mm) fall at 1.5 m/s, snow flakes at
 * 1 m/s, spray droplets (0.1–1 mm) at 1–4 m/s, fountain drops (3 mm) at 8 m/s, dust at
 * 0.1 m/s; smoke is buoyant instead. A fountain throws its water at √(2 g h) for a jet of
 * `h` metres; a jet engine's exhaust leaves at hundreds of m/s; soaring birds circle a thermal
 * ~50 m wide at ~10 m/s.
 */
export const PRESETS: Record<ParticleKind, Preset> = {
  sand: row(60, 2, 2, 'up', 0.8, -G, 0.15, 0.15, '#d9b98a', 0.6, 1_200),
  'snow-plume': row(80, 4, 1, 'up', 1, -G, 0.1, 0.4, '#f4f8ff', 0.7, 1_600),
  'waterfall-spray': row(90, 2.5, 4, 'out', 0.9, -G, 0.25, 0.5, '#e8f2f6', 0.35, 1_200),
  smoke: row(6, 12, 1.5, 'up', 0.2, 2, 1, 6, '#8d8f94', 0.35, 600),
  fountain: row(120, 1.6, Math.sqrt(2 * G * 4), 'up', 0.12, -G, 0.8, 0.2, '#d6ecff', 0.6, 800),
  'jet-exhaust': row(80, 1.5, 150, 'ahead', 0.05, 0, 0.3, 3, '#b9b4ac', 0.25, 600),
  'runway-dust': row(30, 5, 2, 'out', 0.6, -G, 0.01, 3, '#b7a58a', 0.25, 600),
  birds: {
    ...row(0.2, 60, 0, 'up', 0, 0, 0, 0.6, '#1d1e22', 1, 120),
    motion: 'orbit',
    when: 'day',
    orbit: { radius: 50, rate: 10 / 50 },
  },
  fireflies: {
    ...row(8, 10, 0, 'up', 0, 0, 0, 0.08, '#d8ff6a', 1, 400),
    motion: 'wander',
    additive: true,
    when: 'night',
    orbit: { radius: 1.5, rate: 0.6 },
  },
  // Emitted by the page behind a moving car (`effects.emit`), never by a marker's own rate.
  'road-dust': row(0, 4, 1.5, 'up', 0.9, -G, 0.05, 2.5, '#b89f7c', 0.3, 500),
  'sea-spray': row(60, 3, 7, 'up', 0.5, -G, 0.4, 0.8, '#f2f7f8', 0.4, 900),
};

export const isParticleKind = (kind: EffectKind): kind is ParticleKind => kind in PRESETS;
