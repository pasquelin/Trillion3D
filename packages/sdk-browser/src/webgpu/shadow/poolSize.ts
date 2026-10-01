import {
  SHADOW_PAGE,
  shadowPoolShape,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts';
import type { BackendContext } from '../../backend/types.ts';
import { shadowCasterLights } from '../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { shadowAtlasBytes, type GpuShadowAtlas } from '../../gpu/shadow/atlas.ts';
import { grantedShadowPool, type Granted } from '../residency/poolGrants.ts';
import { startGrant } from '../../gpu/core/errorScope.ts';
import { shadowPoolFor } from './poolFor.ts';
import { createShadowRegionList } from './regions.ts';
import { createShadowPageRequests } from './pageRequests.ts';
import { grantsShadowLayer, noteShadowPressure } from './memoryGrant.ts';
import {
  grantShadowTransmittance,
  sceneCastsBlended,
  transmittanceSettled,
} from './transmittanceGrant.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import { SHADOW_ATLAS_BYTES, SHADOW_GRANT_BYTES } from '../../residency/shadowBudgetBytes.ts';

/** The pages a world's shadow pool holds: its `shadowPoolPages` option, else the setting's
 *  (`LIGHT_SETTINGS.shadowPoolPages`); the memory budget's pool bounds it (`shadowPoolFor`). */
const shadowPoolPagesOf = (context: Pick<BackendContext, 'shadowPoolPages'>) =>
  context.shadowPoolPages ?? LIGHT_SETTINGS.shadowPoolPages;

/** Pages a side of one layer as wide as a device of `limits` draws: a pool that fits it is one
 *  pass a batch. */
const layerSideOf = (limits: Pick<GPUSupportedLimits, 'maxTextureDimension2D'>) =>
  Math.floor(limits.maxTextureDimension2D / SHADOW_PAGE);

/** The pool's shape on a device of `limits`, as `askShadowPool` asks it: the host plan is made at
 *  it, before the grant confirms it (`../pages/runtime.ts`). */
export const shadowPoolShapeOf = (
  context: Pick<BackendContext, 'shadowPoolPages'>,
  limits?: Pick<GPUSupportedLimits, 'maxTextureDimension2D'>,
) => shadowPoolShape(shadowPoolPagesOf(context), limits && layerSideOf(limits));

/** Whether the shadows' grant holds the static layer beside what the pool holds and the
 *  transmittance layer still to come; past it, said and recorded (`memoryGrant.ts`). The layer
 *  brings the occlusion test, whose list follows the cull's (`followOcclusion`): the rows the GPU
 *  pages' pairs grew the cull's by (`pairBytes`, `pairGrowth.ts`) are asked for it too. */
export function staticLayerGranted(
  lights: WebgpuLightState,
  diagnose: WebgpuPagesRuntime['diag']['engineDiagnostic'],
  grantBytes = SHADOW_GRANT_BYTES,
) {
  const { side, layers } = lights.plan.pool,
    transmittance = transmittanceSettled(lights) ? 0 : shadowTransmittanceBytes(side, layers);
  return grantsShadowLayer(
    lights,
    diagnose,
    'static-layer-over-grant',
    'The shadow static layer is past the shadow grant',
    shadowAtlasBytes(side, layers) + (lights.occlusion ? 0 : lights.memory.pairBytes),
    grantBytes,
    transmittance,
  );
}

/** What the shadow pool asks of the device for `wanted` pages — its setting's —, granted at most
 *  the memory budget's atlas bytes (`SHADOW_ATLAS_BYTES`); nothing without a caster, or during a
 *  capture. `grant` asks it (`grantedShadowPool`). */
function askShadowPool(
  rt: WebgpuPagesRuntime,
  atlas: GpuShadowAtlas,
  device: GPUDevice,
  wanted: number,
) {
  const casters = rt.capture.capturing ? 0 : shadowCasterLights(rt.lights.store);
  if (!casters) return undefined;
  const rule = shadowPoolFor(wanted, layerSideOf(device.limits));
  // Granted from the budget itself: a pool it holds short of `wanted` stays named `ceiling`.
  const grant = () =>
    grantedShadowPool(device, SHADOW_ATLAS_BYTES, rule, rt.diag.engineDiagnostic, (pool) =>
      atlas.makePool(pool.side, pool.layers),
    );
  return { wanted, target: rule(SHADOW_ATLAS_BYTES), grant };
}

/** A shadow pool the device granted, and its texture. */
type GrantedPool = Granted<ReturnType<ReturnType<typeof shadowPoolFor>>, GPUTexture>;

/**
 * Takes the pool the device granted for `wanted` pages, once: the plan pages it (`plan.size`); the
 * atlas holds its texture; the region list and the request return path follow its pages, the
 * seed's path freed once its reads have landed.
 */
function adoptShadowPool(
  rt: WebgpuPagesRuntime,
  atlas: GpuShadowAtlas,
  device: GPUDevice,
  granted: GrantedPool,
  wanted: number,
) {
  const { lights, diag } = rt,
    { side, layers, clamp, allocatedBytes } = granted.pool;
  // Coarser pages for memory alone, by name: the halvings the device's refusals took.
  if (granted.halvings) noteShadowPressure(lights.memory, 'pool-shrunk', granted.halvings);
  lights.plan.size(side, layers);
  atlas.sizePool(side, layers, granted.made);
  const requests = lights.pageRequests;
  lights.regions = createShadowRegionList(side);
  lights.pageRequests = createShadowPageRequests(
    device,
    lights.plan.pool.pages,
    lights.plan.sunWindow,
  );
  void requests?.settled().then(requests.dispose);
  diag.engineDiagnostic('shadow-pool', 'Shadow pool allocated at its setting', {
    version: 2,
    wanted,
    side,
    layers,
    pages: lights.plan.pool.pages,
    bytes: allocatedBytes,
    clamp,
  });
}

/** The pool full, said once as it comes to be (`poolCeiling.ts`), as the reference engine warns of a physical
 *  page pool overflow: what the scene asks past it reads the coarser level (`shadowPagesOverflow`). */
export function sayShadowCeiling(rt: WebgpuPagesRuntime, wanted: number) {
  rt.diag.engineDiagnostic(
    'shadow-pool',
    'The shadow pool is full: the pages past it read the coarser level',
    { kind: 'warning', version: 2, wanted, pages: rt.lights.plan.pool.pages, clamp: 'ceiling' },
  );
}

/**
 * Allocates the shadow pool at the first frame that draws a light casting a shadow (`askShadowPool`),
 * once, at its setting (`shadowPoolPagesOf`), as the reference engine allocates its physical pages up front from
 * `a reference setting`: it is never resized after (`poolCeiling.ts`), so a page
 * keeps its place, its depth and its static layer for as long as it is mapped (#831). Until then
 * no shadow page exists; the plan built at creation pages the granted pool from then on
 * (`adoptShadowPool`), keeping the host's settings. A capture never sizes the pool: the next
 * frame does.
 *
 * The atlas texture is allocated under an out-of-memory check, like the geometry and texture pools
 * (`grantedShadowPool`): a pool the device refuses is drawn at half its bytes, down to the smallest
 * screen's side — coarser shadow pages —, and said under `gpu-out-of-memory` (`pool-shrunk`,
 * `memoryGrant.ts`). Until the device answers, the frame is held (`holdWebgpuFrame`) — the
 * previous image stays, or nothing yet, never one without its shadows — and a capture waits
 * (`deviceAnswer`). When it refuses even the floor, the shadowed mode cannot be drawn: it is
 * refused by the `shadows-off` error (`pool-refused`), and the session goes on without shadows,
 * never lost. A world without a light that casts a shadow sizes nothing: its pool would hold no
 * page. The first frame that has one sizes it, before its plan maps any page. A scene whose
 * blended surfaces cast asks their transmittance layer in the same grant (`transmittanceGrant.ts`).
 */
export function sizeShadowPool(rt: WebgpuPagesRuntime) {
  const { lights, diag, run } = rt,
    atlas = lights.shadows,
    device = rt.gpu.device;
  if (!atlas || !device || atlas.texture || lights.shadowGrant) return;
  const ask = askShadowPool(rt, atlas, device, shadowPoolPagesOf(rt.context));
  if (!ask) return;
  const done = ask.grant().then(
    async (granted) => {
      if (!granted) {
        // Never silent: the image loses its shadows, and the page is told so by name, in the
        // diagnostic and in every frame's shadow report (`unavailable`).
        if (run.lost || rt.signal.aborted) return;
        lights.shadowReason = 'shadow pool refused by the device';
        noteShadowPressure(lights.memory, 'pool-refused');
        diag.engineDiagnostic('shadows-off', 'The device refused the smallest shadow pool', {
          kind: 'error',
          reason: 'gpu-out-of-memory',
          requestedBytes: ask.target.allocatedBytes,
        });
        return;
      }
      // A session closed, or a device lost, while the device answered keeps nothing.
      if (run.lost || rt.signal.aborted || lights.shadows !== atlas) return granted.made.destroy();
      adoptShadowPool(rt, atlas, device, granted, ask.wanted);
      // A scene whose blended surfaces cast asks their layer with the pool, the frame still held.
      if (sceneCastsBlended(rt)) await grantShadowTransmittance(rt);
      run.gate.resourcesChanged();
    },
    (error: unknown) => {
      if (!run.lost) diag.diagnosticFailure('shadow-pool-unavailable', error);
    },
  );
  lights.shadowGrant = startGrant(done);
}
