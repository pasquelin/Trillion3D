import {
  BOUNCE_SETTINGS,
  LIGHT_SETTINGS,
  type SceneProxy,
} from '../../../../../sdk-core/src/index.ts';
import { createGpuBounceProxy } from '../../../bounce/proxy.ts';
import { createGpuSunFarShadow } from '../../../gpu/shadow/sunFarShadow.ts';
import { grantCapability } from '../io/drops.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What the capability declares while no far shadow is fitted on this scene. */
const SUN_FAR_CAPABILITY = 'sun shadows beyond the last clipmap level';
/** Named approximations of the far shadow, published in the diagnostic (P5). */
const SUN_FAR_APPROXIMATIONS = [
  'the shadow ray hits the resident proxy, whose certified geometric error moves the shadow edge',
  'a shadow ray that exhausts the published traversal bound reports no blocker, which lights',
  'the ray starts one proxy cell along its own direction, so a blocker nearer than that is missed',
  'the proxy carries no alpha cutout, so a masked foliage casts the shadow of its full triangle',
  'one ray per pixel gives a hard shadow: the far sun has no penumbra, unlike the filtered clipmap levels',
];

/**
 * Fits the sun's far shadow, at the first image that carries a declared light.
 *
 * The resident proxy is that of bouncing light when it is on: it is borrowed as-is, never reloaded,
 * never held twice. Off, this module loads its own — the sun's shadow does not depend on a bounce
 * setting; it is the fidelity of the direct that is at stake.
 *
 * With no proxy in the cache, nothing is fitted: the surface beyond the last clipmap level stays lit with
 * no cast shadow, exactly as before this lot, and the diagnostic says so. Stretching the last level
 * to the far field would have divided the texel density of every near shadow by five, on each axis: a
 * quality drop to hide an absence, refused.
 */
export function ensureSunFarShadow(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { sunFar, bounce, context } = rt;
  if (sunFar.gpu?.proxy) return;
  // Bouncing light already loads this proxy: we wait for its own rather than holding two.
  const shared = bounce.probes?.proxy;
  if (!shared && bounce.wanted && !bounce.reason) return;
  if (!sunFar.gpu) sunFar.gpu = createGpuSunFarShadow(device);
  if (shared) {
    sunFar.borrowed = true;
    sunFar.gpu.adopt(shared, false);
    grantCapability(rt.capabilities, SUN_FAR_CAPABILITY);
    rt.run.gate.resourcesChanged();
    return publish(rt);
  }
  if (sunFar.pending || sunFar.reason) return;
  if (!context.readSceneProxy) {
    sunFar.reason = 'far shadow unavailable: the cache holds no resident proxy';
    return publish(rt);
  }
  sunFar.pending = context
    .readSceneProxy()
    .then((proxy: SceneProxy) => {
      sunFar.gpu?.adopt(createGpuBounceProxy(device, proxy), true);
      grantCapability(rt.capabilities, SUN_FAR_CAPABILITY);
      rt.run.gate.resourcesChanged();
      publish(rt);
    })
    .catch((error: unknown) => {
      sunFar.reason = `far shadow unavailable: resident proxy unreadable (${String(error)})`;
      rt.diag.diagnosticFailure('sun-far-shadow-unavailable', error);
      publish(rt);
    });
}

/** What the far shadow actually obtained. Never an estimate, never a deduced zero. */
function publish(rt: WebgpuPagesRuntime) {
  const { sunFar, diag } = rt,
    // The fitted module, and only once its proxy is adopted: without a proxy, its settings describe
    // no ray, and it is `null` that must be published, not the zero of their birth.
    ready = sunFar.gpu?.proxy ? sunFar.gpu : undefined,
    proxy = ready?.proxy;
  if (sunFar.published && !proxy) return;
  sunFar.published = true;
  diag.engineDiagnostic('sun-far-shadow', 'Sun far shadows against proxy', {
    version: 1,
    clipmapLevels: LIGHT_SETTINGS.sunLevels,
    traversalSteps: BOUNCE_SETTINGS.traversalSteps,
    borrowedFromBounce: proxy ? sunFar.borrowed : null,
    proxyTriangles: proxy?.triangleCount ?? null,
    proxyNodes: proxy?.nodeCount ?? null,
    proxyBytes: proxy?.bytes ?? null,
    proxyErrorMetres: proxy?.errorMetres ?? null,
    proxyCellMetres: proxy?.cellMetres ?? null,
    rayOffsetMetres: ready?.offsetMetres ?? null,
    rayStartMetres: ready?.startMetres ?? null,
    rayMaxMetres: ready?.maxDistanceMetres ?? null,
    unavailable: sunFar.reason,
    approximations: SUN_FAR_APPROXIMATIONS,
  });
}

/** Far-shadow state, as the per-stage profile and image tracking publish it. */
export function sunFarState(rt: WebgpuPagesRuntime) {
  const { gpu, reason } = rt.sunFar,
    counts = gpu?.counts();
  return {
    proxyTriangles: gpu?.proxy?.triangleCount ?? null,
    pixelsTestes: counts?.tested ?? null,
    pixelsAssombris: counts?.blocked ?? null,
    imageRelevee: counts?.frame ?? null,
    unavailable: reason,
  };
}

/**
 * Counts of the Far shadows stage, only those that came back: a sample that has not come back is not
 * deposited at all, there is no deduced zero.
 */
export function sunFarCounts(rt: WebgpuPagesRuntime) {
  const { proxyTriangles, pixelsTestes, pixelsAssombris, imageRelevee } = sunFarState(rt);
  const releves = { trianglesDuProxy: proxyTriangles, pixelsTestes, pixelsAssombris, imageRelevee };
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(releves)) if (value !== null) counts[name] = value;
  return counts;
}
