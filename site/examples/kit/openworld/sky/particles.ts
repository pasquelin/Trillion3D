import type { Vec3 } from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import type { GeometryLike, MeshLike, SkyEngine } from './engine.ts';
import { createPool, spawn, step, type Pool } from './pool.ts';
import type { Preset } from './presets.ts';
import type { Random } from './random.ts';
import type { Wind } from './wind.ts';

/**
 * A launch velocity for `preset`: a cone of half-angle `spread` around straight up, around a
 * random horizontal heading tilted up (`out`), or around `ahead` when the caller gives one.
 */
export function launch(preset: Preset, next: Random, ahead?: Vec3): [number, number, number] {
  const around = next() * 2 * Math.PI;
  const s = preset.speed;
  if (preset.launch === 'up') {
    const tilt = preset.spread * Math.sqrt(next());
    return [
      Math.sin(tilt) * Math.cos(around) * s,
      Math.cos(tilt) * s,
      Math.sin(tilt) * Math.sin(around) * s,
    ];
  }
  if (preset.launch === 'ahead' && ahead) {
    const length = Math.hypot(ahead[0], ahead[1], ahead[2]) || 1;
    const jitter = () => (next() * 2 - 1) * preset.spread;
    return [0, 1, 2].map((c) => (ahead[c] / length + jitter()) * s) as [number, number, number];
  }
  const rise = preset.spread * next();
  return [
    Math.cos(rise) * Math.cos(around) * s,
    Math.sin(rise) * s,
    Math.cos(rise) * Math.sin(around) * s,
  ];
}

/** A start point inside the emitter's disc of `radius` around `at`, uniform over its area. */
function scatter(at: Vec3, radius: number, next: Random): [number, number, number] {
  const r = radius * Math.sqrt(next());
  const a = next() * 2 * Math.PI;
  return [at[0] + Math.cos(a) * r, at[1], at[2] + Math.sin(a) * r];
}

export type ParticleSystem = {
  node: MeshLike;
  pool: Pool;
  /** Adds `count` particles around `at` (dropped once the pool is full). */
  emit(at: Vec3, radius: number, count: number, ahead?: Vec3): void;
  /** Moves the particles, then hands their positions to the engine's `points` object. */
  update(seconds: number, wind: Wind): void;
};

/**
 * One effect kind as one `points` object over a fixed pool: live particles are packed at the
 * front, drawn with `setDrawRange`, and the slots past them repeat the first live particle so
 * nothing stale shows while the engine lacks the draw range.
 */
export function createParticleSystem(
  engine: SkyEngine,
  preset: Preset,
  next: Random,
): ParticleSystem {
  const pool = createPool(preset.capacity);
  const positions = engine.buffer.float32(new Float32Array(preset.capacity * 3), 3);
  const geometry: GeometryLike = engine.geometry.createBuffer({ position: positions });
  const node = engine.object.points(
    geometry,
    engine.material.points({
      color: preset.colour,
      size: preset.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: preset.opacity,
      depthWrite: false,
      blending: preset.additive ? engine.blending.additive : engine.blending.normal,
    }),
  );
  node.visible = false;
  const forces = {
    lift: preset.lift,
    drag: preset.response > 0 ? 1 / preset.response : 0,
    wind: { x: 0, z: 0 },
  };
  const shape = preset.orbit ?? { radius: 0, rate: 0 };
  return {
    node,
    pool,
    emit(at, radius, count, ahead) {
      for (let index = 0; index < count; index++)
        if (
          !spawn(
            pool,
            scatter(at, radius, next),
            launch(preset, next, ahead),
            preset.life,
            next() * 2 * Math.PI,
          )
        )
          return;
    },
    update(seconds, wind) {
      forces.wind = preset.response > 0 ? wind.at(10) : { x: 0, z: 0 };
      step(pool, seconds, preset.motion, forces, shape);
      const live = pool.alive * 3;
      const out = positions.array;
      for (let i = 0; i < live; i++) out[i] = pool.position[i];
      for (let i = live; i < pool.capacity * 3; i++) out[i] = pool.position[i % 3];
      positions.needsUpdate = true;
      // Waiting on the engine: `setDrawRange` on a points geometry.
      geometry.setDrawRange?.(0, pool.alive);
      node.visible = pool.alive > 0;
    },
  };
}
