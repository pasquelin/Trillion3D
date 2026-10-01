import { fixedClock } from '../clock.ts';
import {
  MAX_CATCHUP,
  MAX_SPLATS,
  type RippleFrame,
  type RippleWork,
  type RippleSpec,
  type Splat,
} from './types.ts';

/** Linearised shallow water with a Rusanov flux. A two-dimensional explicit step needs
 *  2 sqrt(g depth) dt / dx <= 1. Recentring moves integer cells, never the world-space wave. */
export function createRippleModel(spec: RippleSpec) {
  const { resolution, rate, extent = 64, depth = 0.01, damping = 0.4 } = spec;
  if (![256, 384, 512].includes(resolution) || ![7.5, 15, 30].includes(rate))
    throw new RangeError('Ripple resolution or rate is not a measured candidate');
  if (![extent, depth, damping].every(Number.isFinite) || extent <= 0 || depth <= 0 || damping < 0)
    throw new RangeError('Ripple extent/depth must be positive and damping nonnegative');
  const dx = extent / resolution,
    dt = 1 / rate;
  if ((2 * Math.sqrt(9.81 * depth) * dt) / dx > 1)
    throw new RangeError('Ripple shallow-water CFL exceeds one');
  if (
    ![dx, extent * 2, depth, damping].every((value) => Number.isFinite(Math.fround(value))) ||
    Math.fround(dx) <= 0 ||
    Math.fround(depth) <= 0
  )
    throw new RangeError('Ripple parameters exceed GPU float range');
  const records = new Float32Array(MAX_SPLATS * 4);
  const empty: readonly Splat[] = [];
  const work: RippleWork & { shiftX: number; shiftZ: number } = {
    steps: 0,
    splats: 0,
    dropped: 0,
    droppedSteps: 0,
    shiftX: 0,
    shiftZ: 0,
    recentered: false,
  };
  const clock = fixedClock(rate, MAX_CATCHUP);
  let centerX = 0,
    centerZ = 0,
    initialized = false;
  return {
    resolution,
    rate,
    extent,
    depth,
    damping,
    dx,
    dt,
    records,
    /** Two RGBA16F textures and one fixed 64-instance staging buffer; uniforms are backend-owned. */
    stateBytes: 2 * resolution * resolution * 8,
    plan(seconds: number, frame?: RippleFrame) {
      if (!Number.isFinite(seconds) || seconds < 0)
        throw new RangeError('Ripple elapsed time must be finite and nonnegative');
      const cameraX = frame?.camera[0] ?? centerX,
        cameraZ = frame?.camera[1] ?? centerZ;
      if (
        !Number.isFinite(cameraX) ||
        !Number.isFinite(cameraZ) ||
        !Number.isSafeInteger(Math.floor(cameraX / dx)) ||
        !Number.isSafeInteger(Math.floor(cameraZ / dx))
      )
        throw new RangeError('Ripple camera must be finite');
      const nextX = Math.floor(cameraX / dx) * dx,
        nextZ = Math.floor(cameraZ / dx) * dx;
      const shiftX = initialized ? Math.round((nextX - centerX) / dx) : 0;
      const shiftZ = initialized ? Math.round((nextZ - centerZ) / dx) : 0;
      let count = 0,
        dropped = 0;
      for (const splat of frame?.splats ?? empty) {
        if (count === MAX_SPLATS) {
          dropped++;
          continue;
        }
        const [x, z, radius, impulse] = splat;
        if (
          splat.length !== 4 ||
          !splat.every(Number.isFinite) ||
          radius <= 0 ||
          Math.abs(impulse) > 1
        )
          throw new RangeError(
            'Ripple splats need finite coordinates, positive radius and |height| <= 1m',
          );
        const localX = x - nextX,
          localZ = z - nextZ;
        const boundedRadius = Math.min(radius, extent);
        if (
          Math.abs(localX) - boundedRadius > extent / 2 ||
          Math.abs(localZ) - boundedRadius > extent / 2
        ) {
          dropped++;
          continue;
        }
        const at = count++ * 4;
        records[at] = localX;
        records[at + 1] = localZ;
        records[at + 2] = boundedRadius;
        records[at + 3] = impulse;
      }
      centerX = nextX;
      centerZ = nextZ;
      initialized = true;
      const previousDropped = clock.dropped;
      work.steps = clock.advance(seconds);
      work.droppedSteps = clock.dropped - previousDropped;
      work.splats = count;
      work.dropped = dropped;
      work.shiftX = shiftX;
      work.shiftZ = shiftZ;
      work.recentered = shiftX !== 0 || shiftZ !== 0;
      return work;
    },
  };
}
