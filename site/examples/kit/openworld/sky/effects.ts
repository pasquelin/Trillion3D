import type {
  EffectKind,
  Marker,
  Mover,
  Vec3,
} from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import { createBeams } from './beam.ts';
import type { NodeLike, SkyEngine, SkyWorld } from './engine.ts';
import { createParticleSystem, type ParticleSystem } from './particles.ts';
import { isParticleKind, PRESETS, type ParticleKind } from './presets.ts';
import { mulberry32 } from '../../random.ts';
import type { Wind } from './wind.ts';

type Emitter = Extract<Marker, { kind: 'emitter' }>;

/** Effects that need a pass over the finished image: declared, drawn once the engine has one. */
const POST: readonly EffectKind[] = ['heat-haze', 'neon-glow'];

/**
 * How far an emitter of `kind` is worth running: past the distance where one particle covers
 * less than a pixel (`size / pixelAngle`), or past `limit` (the fog's far end), nothing shows.
 */
function reach(kind: ParticleKind, pixelAngle: number, limit: number): number {
  return Math.min(PRESETS[kind].size / pixelAngle, limit);
}

export type Effects = {
  node: NodeLike;
  /** Emitters whose effect waits on post-processing, for the page's "in progress" note. */
  pending: readonly Emitter[];
  /** Adds `count` particles of `kind` at `at` (road dust behind a car, exhaust behind a jet). */
  emit(kind: ParticleKind, at: Vec3, count: number, ahead?: Vec3): void;
  /** Runs the emitters near `camera`, moves every particle and turns the beams. */
  update(seconds: number, camera: Vec3, wind: Wind, nightFactor: number): void;
  /** The particle system of one kind, for tests and readouts. */
  system(kind: ParticleKind): ParticleSystem;
};

/**
 * Every emitter marker the regions placed, one pooled `points` object per kind: an emitter
 * runs only while the camera is within its reach, and a kind never holds more than its
 * preset's capacity, however many emitters ask.
 */
export function createEffects(
  engine: SkyEngine,
  world: Pick<SkyWorld, 'postProcessing'>,
  options: {
    seed: number;
    markers: readonly Marker[];
    movers: readonly Mover[];
    pixelAngle: number;
    limit: number;
  },
): Effects {
  const emitters = options.markers.filter((m): m is Emitter => m.kind === 'emitter');
  const next = mulberry32(options.seed);
  const node = engine.object.group();
  const systems = new Map<ParticleKind, ParticleSystem>();
  for (const kind of Object.keys(PRESETS) as ParticleKind[]) {
    const system = createParticleSystem(engine, PRESETS[kind], next);
    systems.set(kind, system);
    node.add(system.node);
  }
  const running = emitters.flatMap((emitter) => {
    const kind = emitter.effect;
    return isParticleKind(kind) ? [{ emitter, kind, carry: 0 }] : [];
  });
  const beams = createBeams(
    engine,
    emitters.filter((e) => e.effect === 'lighthouse-beam'),
    options.movers,
  );
  node.add(beams.node);
  const pending = emitters.filter((e) => POST.includes(e.effect));
  for (const emitter of pending) {
    // Waiting on the engine: post-processing (heat shimmer, bloom around neon).
    const pass =
      emitter.effect === 'heat-haze'
        ? engine.post?.heatHaze({ position: emitter.position, radius: emitter.radius, strength: 1 })
        : engine.post?.bloom({ position: emitter.position, radius: emitter.radius, threshold: 1 });
    if (pass) world.postProcessing?.add(pass);
  }
  let clock = 0;
  const system = (kind: ParticleKind) => systems.get(kind) as ParticleSystem;
  return {
    node,
    pending,
    emit: (kind, at, count, ahead) => system(kind).emit(at, 0, count, ahead),
    update(seconds, camera, wind, nightFactor) {
      clock += seconds;
      for (const run of running) {
        const preset = PRESETS[run.kind];
        const [x, y, z] = run.emitter.position;
        const far = reach(run.kind, options.pixelAngle, options.limit);
        const near = Math.hypot(x - camera[0], y - camera[1], z - camera[2]) < far;
        const awake =
          preset.when === 'night'
            ? nightFactor >= 0.5
            : preset.when === 'day'
              ? nightFactor < 0.5
              : true;
        if (!near || !awake) {
          run.carry = 0;
          continue;
        }
        run.carry += preset.rate * seconds;
        const count = Math.floor(run.carry);
        run.carry -= count;
        if (count > 0) system(run.kind).emit(run.emitter.position, run.emitter.radius, count);
      }
      for (const each of systems.values()) each.update(seconds, wind);
      beams.update(clock, nightFactor);
    },
    system,
  };
}
