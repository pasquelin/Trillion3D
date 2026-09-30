import {
  SHADOW_PAGE,
  shadowPoolSide,
  shadowPoolSize,
  shadowPoolShape,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowCasterLights } from '../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { shadowAtlasBytes, type GpuShadowAtlas } from '../../gpu/shadow/atlas.ts';
import { grantedShadowPool, type Granted } from '../residency/poolGrants.ts';
import { startGrant } from '../../gpu/core/errorScope.ts';
import type { PoolClamp } from '../../residency/pools.ts';
import { createShadowRegionList } from './regions.ts';
import { createShadowPageRequests } from './pageRequests.ts';
import { grantsShadowLayer, noteShadowPressure } from './memoryGrant.ts';
import {
  grantShadowTransmittance,
  sceneCastsBlended,
  transmittanceSettled,
} from './transmittanceGrant.ts';
import {
  shadowTransmittanceBytes,
  type ShadowTransmittance,
} from '../../gpu/shadow/transmittance.ts';
import { SHADOW_ATLAS_BYTES, SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** The smallest shadow pool: the side a one-pixel screen asks (`shadowPoolSide`). */
const FLOOR_SIDE = shadowPoolSide(1, 1);

/** The shadow pool `budgetBytes` holds for a screen that asks `wanted` pages: the fewest layers
 *  that hold what fits, of the largest side that fits, never below the floor. Short of `wanted`
 *  at the memory budget's atlas bytes (`SHADOW_ATLAS_BYTES`), the budget holds it, not the device. */
const shadowPoolFor = (wanted: number, layerSide?: number) => (budgetBytes: number) => {
  const pages = Math.min(wanted, Math.floor(budgetBytes / shadowAtlasBytes(1)));
  const { side: full, layers } = shadowPoolShape(pages, layerSide),
    fits = Math.floor(Math.sqrt(budgetBytes / shadowAtlasBytes(1, layers)));
  const floor = Math.min(FLOOR_SIDE, shadowPoolShape(wanted, layerSide).side),
    side = Math.max(floor, Math.min(full, fits));
  const held = budgetBytes >= SHADOW_ATLAS_BYTES ? 'ceiling' : 'device-limit';
  const clamp: PoolClamp =
    side <= FLOOR_SIDE ? 'minimum' : side * side * layers < wanted ? held : null;
  return { budgetBytes, side, layers, allocatedBytes: shadowAtlasBytes(side, layers), clamp };
};

/** Whether the shadows' grant holds the static layer beside what the pool holds and the
 *  transmittance layer still to come; past it, said and recorded (`memoryGrant.ts`). */
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
    shadowAtlasBytes(side, layers),
    grantBytes,
    transmittance,
  );
}

/** What the shadow pool asks of the device for the frame's drawing buffer and the lights that cast
 *  now, each counted over the whole screen (`shadowPoolSize`), granted at most the memory budget's
 *  atlas bytes (`SHADOW_ATLAS_BYTES`); nothing without a caster, or for a capture's temporary
 *  size. `grant` asks it (`grantedShadowPool`). */
export function askShadowPool(rt: WebgpuPagesRuntime, atlas: GpuShadowAtlas, device: GPUDevice) {
  const casters = rt.capture.capturing ? 0 : shadowCasterLights(rt.lights.store);
  if (!casters) return undefined;
  const viewport: [number, number] = [rt.setup.viewport[0], rt.setup.viewport[1]],
    wanted = shadowPoolSize(viewport[0], viewport[1], casters),
    // One layer as wide as the device draws: a pool that fits it is one pass a batch, as before.
    layerSide = Math.floor(device.limits.maxTextureDimension2D / SHADOW_PAGE),
    rule = shadowPoolFor(wanted, layerSide);
  // Granted from the budget itself: a pool it holds short of `wanted` stays named `ceiling`.
  const grant = () =>
    grantedShadowPool(device, SHADOW_ATLAS_BYTES, rule, rt.diag.engineDiagnostic, (pool) =>
      atlas.makePool(pool.side, pool.layers),
    );
  return { viewport, target: rule(SHADOW_ATLAS_BYTES), grant };
}

/** A shadow pool the device granted, and its texture. */
type GrantedPool = Granted<ReturnType<ReturnType<typeof shadowPoolFor>>, GPUTexture>;

/**
 * Takes the pool the device granted for `viewport`: the plan pages it, keeping every page it holds
 * (`plan.resize`); the atlas holds its texture, and `layer`, the transmittance layer made for it;
 * the region list and the request return path follow its pages, the old path freed once its
 * reads have landed. Returns the plan's page moves and what the atlas held before, if anything.
 */
export function adoptShadowPool(
  rt: WebgpuPagesRuntime,
  atlas: GpuShadowAtlas,
  device: GPUDevice,
  granted: GrantedPool,
  viewport: readonly [number, number],
  layer?: ShadowTransmittance,
) {
  const { lights, diag } = rt,
    { side, layers, clamp, allocatedBytes } = granted.pool;
  // Coarser pages for memory alone, by name: the halvings the device's refusals took.
  if (granted.halvings) noteShadowPressure(lights.memory, 'pool-shrunk', granted.halvings);
  const moved = lights.plan.resize(side, layers),
    held = atlas.sizePool(side, layers, granted.made, layer),
    requests = lights.pageRequests;
  lights.regions = createShadowRegionList(side);
  lights.poolView = viewport;
  lights.pageRequests = createShadowPageRequests(
    device,
    lights.plan.pool.pages,
    lights.plan.sunWindow,
  );
  void requests?.settled().then(requests.dispose);
  diag.engineDiagnostic(
    'shadow-pool',
    held ? 'Shadow pool resized with the view' : 'Shadow pool sized from the first frame',
    {
      version: 1,
      viewport,
      side,
      layers,
      pages: lights.plan.pool.pages,
      bytes: allocatedBytes,
      clamp,
    },
  );
  return { moved, held };
}

/**
 * Sizes the shadow pool at the first frame that draws a light casting a shadow (`askShadowPool`): a
 * world may prepare on a canvas that is not laid out yet — the HTML default of 300 × 150, or the
 * session's default size — and only takes its real drawing buffer at its first frame. Until then
 * no shadow page exists; the plan built at creation pages the granted pool from then on
 * (`adoptShadowPool`), keeping the host's settings. A capture's temporary size never sizes the
 * pool: the next frame on the canvas does. A later drawing buffer resizes it (`poolResize.ts`).
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
  const ask = askShadowPool(rt, atlas, device);
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
      adoptShadowPool(rt, atlas, device, granted, ask.viewport);
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
