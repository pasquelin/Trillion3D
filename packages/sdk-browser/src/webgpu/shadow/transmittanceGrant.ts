import { deviceMade, grantPending, startGrant } from '../../gpu/core/errorScope.ts';
import {
  castsBlendShadow,
  shadowTransmittanceBytes,
  type ShadowTransmittance,
} from '../../gpu/shadow/transmittance.ts';
import { refreshSurface } from '../../page/surface.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import { admitShadowBytes, noteShadowPressure, shadowPoolHeld } from './memoryGrant.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Whether a blended surface of the scene casts (`castsBlendShadow`): its pipelines are compiled at
 *  prepare, and its transmittance layer is asked with the pool. */
export const sceneCastsBlended = (rt: WebgpuPagesRuntime) =>
  rt.blendState.blendGpu.some((item) => castsBlendShadow(refreshSurface(item.surface)));

/**
 * THE TRANSMITTANCE LAYER UNDER THE SHADOWS' GRANT (`memoryGrant.ts`): asked of the grant with what
 * the pool already holds, then of the device under an out-of-memory check (`deviceMade`), and taken
 * only once granted. Every mapped page is then stale, so each is drawn again with what the blended
 * casters let through — none when the layer is asked with the pool, before any page.
 *
 * Past the grant (`transmittance-over-grant`, under `shadow-memory`) or refused by the device
 * (`transmittance-refused`, under `gpu-out-of-memory`), the layer is never made nor asked again:
 * every opaque shadow stays drawn whole, and the blended casters cast nothing, by name. A device
 * never meets the layer's refusal inside a frame, which would lose the device and every image.
 */
export async function grantShadowTransmittance(
  rt: WebgpuPagesRuntime,
  grantBytes = SHADOW_GRANT_BYTES,
) {
  const { lights, run, diag } = rt,
    atlas = lights.shadows,
    device = rt.gpu.device;
  if (!atlas?.texture || !device || atlas.transmittanceHeld || lights.transmittanceDenied) return;
  const { side, layers } = lights.plan.pool,
    requestedBytes = shadowTransmittanceBytes(side, layers),
    heldBytes = shadowPoolHeld(lights);
  const deny = (pressure: 'transmittance-over-grant' | 'transmittance-refused') => {
    lights.transmittanceDenied = true;
    noteShadowPressure(lights.memory, pressure);
  };
  if (!admitShadowBytes(lights.memory, heldBytes, requestedBytes, grantBytes)) {
    deny('transmittance-over-grant');
    diag.engineDiagnostic('shadow-memory', 'The shadow transmittance layer is past the grant', {
      kind: 'warning',
      pressure: 'transmittance-over-grant',
      requestedBytes,
      heldBytes,
      grantBytes,
    });
    return;
  }
  let layer: ShadowTransmittance | undefined;
  try {
    layer = await deviceMade(device, atlas.makeTransmittance);
  } catch (error) {
    // Its draws failed to compile: not memory, said apart, and not asked every frame again.
    lights.transmittanceDenied = true;
    diag.diagnosticFailure('shadow-transmittance-unavailable', error);
    return;
  }
  // A session closed, or a device lost, while the device answered keeps nothing.
  if (run.lost || rt.signal.aborted || lights.shadows !== atlas) return layer?.destroy();
  if (!layer) {
    deny('transmittance-refused');
    diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The device refused the shadow transmittance layer',
      {
        kind: 'warning',
        pool: 'shadow-transmittance',
        requestedBytes,
        grantedBytes: null,
      },
    );
    return;
  }
  atlas.takeTransmittance(layer);
  const { pool } = lights.plan,
    now = performance.now();
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0) pool.stale(page, now, run.frame);
  run.gate.resourcesChanged();
}

/**
 * The transmittance layer a frame whose blended casters hold a row draws into (`readTransmittance`).
 * A layer not asked with the pool — a surface turned casting since — is asked now: the frames after
 * this one are held until the device answers (`deviceAnswer`), then its pages are drawn again.
 */
export function frameTransmittance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights } = rt,
    atlas = lights.shadows!;
  if (!atlas.transmittanceHeld && !lights.transmittanceDenied && !grantPending(lights.shadowGrant))
    lights.shadowGrant = startGrant(grantShadowTransmittance(rt));
  return atlas.readTransmittance(encoder);
}
