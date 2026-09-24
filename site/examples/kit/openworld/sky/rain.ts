import type { Vec3 } from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import { wrapAround } from './clouds.ts';
import type { MeshLike, SkyEngine } from './engine.ts';
import { mulberry32 } from '../../random.ts';
import type { Wind } from './wind.ts';

/** Terminal speed of a 2 mm raindrop, m/s (Gunn & Kinzer 1949). */
const FALL_SPEED = 6.5;
/**
 * Not derived: the depth around the camera over which rain reads as separate streaks; past
 * it, rain is a haze, which is the fog's work. A bounded count fills this box, never the sky.
 */
const RADIUS = 40;

export type Rain = {
  node: MeshLike;
  /** 0 dry, 1 the full count of streaks falling. */
  amount: number;
  /** Moves the streaks with gravity and the wind and keeps them around `camera`. */
  update(seconds: number, camera: Vec3, wind: Wind): void;
};

/**
 * Rain as `count` streaks (`lineSegments`) in a box around the camera: each streak is the path
 * its drop covers in one frame, so its length and slant follow the fall speed and the wind.
 * Streaks beyond `amount × count` are folded to zero length, which draws nothing.
 */
export function createRain(engine: SkyEngine, seed: number, count: number): Rain {
  const next = mulberry32(seed);
  const drops = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) drops[i] = (next() - 0.5) * 2 * RADIUS;
  const segments = engine.buffer.float32(new Float32Array(count * 6), 3);
  const node = engine.object.lineSegments(
    engine.geometry.createBuffer({ position: segments }),
    engine.material.line({ color: '#aebccc', transparent: true, opacity: 0.45, depthWrite: false }),
  );
  node.visible = false;
  const rain: Rain = {
    node,
    amount: 0,
    update(seconds, camera, wind) {
      const active = Math.round(Math.max(0, Math.min(1, rain.amount)) * count);
      // Shown or hidden only when it changes: every write asks the world for a frame.
      if (node.visible !== active > 0) node.visible = active > 0;
      if (!active) return;
      const air = wind.at(10);
      const dt = Math.max(seconds, 1 / 60);
      const out = segments.array;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        drops[k] = wrapAround(drops[k] + air.x * seconds, camera[0], 2 * RADIUS);
        drops[k + 1] = wrapAround(drops[k + 1] - FALL_SPEED * seconds, camera[1], 2 * RADIUS);
        drops[k + 2] = wrapAround(drops[k + 2] + air.z * seconds, camera[2], 2 * RADIUS);
        const on = i < active ? dt : 0;
        out[i * 6] = drops[k];
        out[i * 6 + 1] = drops[k + 1];
        out[i * 6 + 2] = drops[k + 2];
        out[i * 6 + 3] = drops[k] - air.x * on;
        out[i * 6 + 4] = drops[k + 1] + FALL_SPEED * on;
        out[i * 6 + 5] = drops[k + 2] - air.z * on;
      }
      segments.needsUpdate = true;
    },
  };
  return rain;
}
