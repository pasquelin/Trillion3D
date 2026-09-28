import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** A memory-pressure event of the shadows, by name (see `ShadowMemory`). */
export type ShadowPressure =
  | 'pool-shrunk'
  | 'pool-refused'
  | 'static-layer-over-grant'
  | 'static-layer-refused'
  | 'transmittance-over-grant'
  | 'transmittance-refused';

/**
 * THE SHADOW MEMORY GRANT: the one fixed share the GPU budget gives the shadows' pool and layers
 * (`SHADOW_GRANT_BYTES`, the batches' reserve left beside it), never a second budget. The pool is
 * drawn within it (`shadowPoolFor`); a late allocation — the static layer, the transmittance
 * layer — is asked of it with what is already held (`admitShadowBytes`).
 *
 * Memory pressure never passes for performance: nothing lowers a page to meet a frame time, and
 * each pressure is an event by name. A pool the device refuses is drawn smaller (`pool-shrunk`,
 * `bias` its halvings, 0 whenever the device grants what the budget asks) or not at all
 * (`pool-refused`, shadows off by name); a static layer past the grant (`static-layer-over-grant`)
 * or refused by the device (`static-layer-refused`) is never made, and every page stays drawn
 * whole, every caster at once: no shadow is lost. A transmittance layer past the grant
 * (`transmittance-over-grant`) or refused (`transmittance-refused`) is never made nor asked again:
 * every opaque shadow stays drawn whole, and the blended casters let all the light through, said
 * under `shadow-memory` or `gpu-out-of-memory` (`transmittanceGrant.ts`).
 */
export type ShadowMemory = {
  /** The most bytes an allocation asked the grant to hold at once, what it already held included. */
  peakBytes: number;
  bias: number;
  /** Replaced, never mutated, at each event: a frame's metrics publish it without a copy. */
  events: readonly ShadowPressure[];
};

/** GPU bytes the shadow pool holds: its buffers and depth pages, their transmittance and static
 *  layers once made, and its request buffer. */
export const shadowPoolHeld = ({ shadows, staticLayer, pageRequests }: WebgpuLightState) =>
  (shadows?.allocationBytes ?? 0) + (staticLayer?.bytes ?? 0) + (pageRequests?.bytes ?? 0);

export const createShadowMemory = (): ShadowMemory => ({ peakBytes: 0, bias: 0, events: [] });

/** Asks the grant for `bytes` more beside the `heldBytes` it holds and the `reserveBytes` kept for
 *  a later layer: true, and the peak raised to what is held then (the reserve not counted), when it
 *  holds all three; false, and nothing counted, past it. */
export function admitShadowBytes(
  memory: ShadowMemory,
  heldBytes: number,
  bytes: number,
  grantBytes = SHADOW_GRANT_BYTES,
  reserveBytes = 0,
) {
  const total = heldBytes + bytes;
  if (total + reserveBytes > grantBytes) return false;
  memory.peakBytes = Math.max(memory.peakBytes, total);
  return true;
}

/** `admitShadowBytes` for a late layer: past the grant, its pressure is recorded and said under
 *  `shadow-memory` with the bytes asked, held and granted. */
export function grantsShadowLayer(
  lights: WebgpuLightState,
  diagnose: WebgpuPagesRuntime['diag']['engineDiagnostic'],
  pressure: 'static-layer-over-grant' | 'transmittance-over-grant',
  message: string,
  bytes: number,
  grantBytes = SHADOW_GRANT_BYTES,
  reserveBytes = 0,
) {
  const heldBytes = shadowPoolHeld(lights);
  if (admitShadowBytes(lights.memory, heldBytes, bytes, grantBytes, reserveBytes)) return true;
  noteShadowPressure(lights.memory, pressure);
  diagnose('shadow-memory', message, {
    kind: 'warning',
    pressure,
    requestedBytes: bytes + reserveBytes,
    heldBytes,
    grantBytes,
  });
  return false;
}

/** Records a pressure by name, once per allocation it concerns; `bias` the pool's halvings. */
export function noteShadowPressure(memory: ShadowMemory, name: ShadowPressure, bias = 0) {
  memory.events = [...memory.events, name];
  memory.bias = Math.max(memory.bias, bias);
}
