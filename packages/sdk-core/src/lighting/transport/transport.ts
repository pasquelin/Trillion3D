import type { Scene } from '../scene/experimentScene.ts';
import {
  LIGHTING_TRANSPORT_ALGORITHM_VERSION,
  LIGHTING_TRANSPORT_FORMAT_VERSION,
  type TransportOptions,
  type TransportResult,
  type TransportSnapshot,
} from './contracts.ts';
import { createTransportState } from './state.ts';
import { updateTransportGeometry } from './geometry.ts';
import { updateTransportVisibility } from './visibility.ts';
import { solveTransport } from './solve.ts';
import { fail, checkpoint, validateScene } from './validation.ts';
export * from './contracts.ts';
export { solveTransportOracle } from './oracle.ts';
const UNSUPPORTED = [
  'hierarchical transport',
  'adjoint scheduling',
  'specular-to-diffuse transport',
] as const;

/**
 * A dense sampled transport experiment, not a hierarchical solver. Both modes use identical rays.
 * Reuse caches intersections with static rectangles, then tests every moving rectangle at its NEW
 * position. Removing an old blocker therefore restores the cached static hit without stale light.
 * Moving source patches recast their own rays. The sphere is an absorbing visibility obstacle;
 * mirror patches must have zero diffuse reflectance. Neither transports specular light into diffuse.
 */
export function createTransport(initialScene: Scene, options: TransportOptions = {}) {
  const state = createTransportState(initialScene, options);
  const { now } = state;
  function update(scene: Scene, mode: 'rebuild' | 'reuse'): TransportResult {
    const started = now();
    try {
      checkpoint(options);
      if (mode !== 'rebuild' && mode !== 'reuse')
        fail('INVALID_OPTIONS', 'Unknown transport update mode');
      validateScene(scene);
      const { geometryChanged, staticChanged } = updateTransportGeometry(state, scene, options);
      const visibility = updateTransportVisibility(
        state,
        scene,
        mode,
        options,
        geometryChanged,
        staticChanged,
      );
      const geometryFinished = now();
      const solved = solveTransport(state, mode, options);
      state.initialized = true;
      const finished = now();
      return {
        formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION,
        mode,
        radiance: state.radiance,
        irradiance: state.irradiance,
        indirectIrradiance: state.indirectIrradiance,
        timings: {
          rayTraceMs: geometryFinished - started,
          solveMs: finished - geometryFinished,
          totalMs: finished - started,
        },
        ...visibility,
        raysReused: state.totalRays - visibility.raysTraced,
        totalRays: state.totalRays,
        ...solved,
        bytes: state.bytes,
        unsupported: UNSUPPORTED,
      };
    } catch (error) {
      state.initialized = false;
      throw error;
    }
  }
  /** Owns fresh copies: later updates cannot change the oracle's input. */
  function snapshot(): TransportSnapshot {
    if (!state.initialized)
      fail('NOT_READY', 'Update transport successfully before taking a snapshot');
    return {
      formatVersion: LIGHTING_TRANSPORT_FORMAT_VERSION,
      algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
      patchCount: state.size,
      matrix: state.matrix.slice(),
      source: state.source.slice(),
      albedo: state.albedo.slice(),
    };
  }
  return { update, snapshot };
}
