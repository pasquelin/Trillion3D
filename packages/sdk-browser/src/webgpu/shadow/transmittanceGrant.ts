import { deviceMade, grantPending, startGrant } from '../../gpu/core/errorScope.ts';
import {
  castsBlendShadow,
  shadowTransmittanceBytes,
  type ShadowTransmittance,
} from '../../gpu/shadow/transmittance.ts';
import { refreshSurface } from '../../page/surface.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import { grantsShadowLayer, noteShadowPressure } from './memoryGrant.ts';
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
  if (!atlas?.texture || !device || transmittanceSettled(lights)) return;
  const { side, layers } = lights.plan.pool,
    requestedBytes = shadowTransmittanceBytes(side, layers);
  const granted = grantsShadowLayer(
    lights,
    diag.engineDiagnostic,
    'transmittance-over-grant',
    'The shadow transmittance layer is past the grant',
    requestedBytes,
    grantBytes,
  );
  if (!granted) {
    lights.transmittanceDenied = true;
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
    lights.transmittanceDenied = true;
    noteShadowPressure(lights.memory, 'transmittance-refused');
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

/** The layer is held, or never to be: nothing left to ask. */
export const transmittanceSettled = (lights: WebgpuPagesRuntime['lights']) =>
  !!lights.shadows?.transmittanceHeld || lights.transmittanceDenied;

/** The layer is neither settled nor asked yet. */
const transmittanceToAsk = ({ lights }: WebgpuPagesRuntime) =>
  !transmittanceSettled(lights) && !grantPending(lights.shadowGrant);

/** Asks the grant for the layer once: never held, denied or already asked. */
function askShadowTransmittance(rt: WebgpuPagesRuntime) {
  if (transmittanceToAsk(rt)) rt.lights.shadowGrant = startGrant(grantShadowTransmittance(rt));
}

/**
 * A blended surface turns casting only by a host rewrite of its values (`castsBlendShadow`,
 * `refreshWebgpuMaterials`), between two frames: the layer is asked there, before the next frame,
 * which is held while the device answers (`deviceAnswering`). No frame is drawn without it.
 */
export function followBlendedCasting(rt: WebgpuPagesRuntime) {
  if (rt.lights.shadows?.texture && transmittanceToAsk(rt) && sceneCastsBlended(rt))
    askShadowTransmittance(rt);
}

/**
 * The transmittance layer a frame whose blended casters hold a row draws into (`readTransmittance`).
 * The layer is asked before the frame — with the pool, or when a surface turns casting
 * (`followBlendedCasting`) —; the ask here is only a guard, never met by a drawn scene.
 */
export function frameTransmittance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  askShadowTransmittance(rt);
  return rt.lights.shadows!.readTransmittance(encoder);
}
