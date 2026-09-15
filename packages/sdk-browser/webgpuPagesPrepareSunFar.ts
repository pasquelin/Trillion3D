import { BOUNCE_SETTINGS, LIGHT_SETTINGS, type SceneProxy } from '../sdk-core/index.ts';
import { createGpuBounceProxy } from './gpuBounceProxy.ts';
import { createGpuSunFarShadow } from './gpuSunFarShadow.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la capacité déclare tant qu'aucune ombre lointaine n'est gréée sur cette scène. */
const SUN_FAR_CAPABILITY = 'sun shadows beyond the last cascade';
/** Approximations nommées de l'ombre lointaine, publiées dans le diagnostic (P5). */
const SUN_FAR_APPROXIMATIONS = [
  'the shadow ray hits the resident proxy, whose certified geometric error moves the shadow edge',
  'a shadow ray that exhausts the published traversal bound reports no blocker, which lights',
  'the ray starts one proxy cell along its own direction, so a blocker nearer than that is missed',
  'the proxy carries no alpha cutout, so a masked foliage casts the shadow of its full triangle',
  'one ray per pixel gives a hard shadow: the far sun has no penumbra, unlike the PCSS cascades',
];

/**
 * Grée l'ombre lointaine du soleil, à la première image qui porte une lampe déclarée.
 *
 * Le proxy résident est celui de la lumière qui rebondit quand elle est allumée : il est emprunté
 * tel quel, jamais rechargé, jamais tenu en double. Éteinte, ce module charge le sien — l'ombre du
 * soleil ne dépend pas d'un réglage de rebond, c'est de la fidélité du direct qu'il s'agit.
 *
 * Sans proxy dans le cache, rien n'est gréé : la surface au-delà de la dernière cascade reste
 * éclairée sans ombre portée, exactement comme avant ce lot, et le diagnostic le dit. Étirer la
 * dernière cascade jusqu'au lointain aurait divisé par cinq la densité de texels de toutes les
 * ombres proches, sur chaque axe : une baisse de qualité pour cacher une absence, refusée.
 */
export function ensureSunFarShadow(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { sunFar, bounce, context } = rt;
  if (sunFar.gpu?.proxy) return;
  // La lumière qui rebondit charge déjà ce proxy : on attend le sien plutôt que d'en tenir deux.
  const shared = bounce.probes?.proxy;
  if (!shared && bounce.wanted && !bounce.reason) return;
  if (!sunFar.gpu) sunFar.gpu = createGpuSunFarShadow(device);
  if (shared) {
    sunFar.borrowed = true;
    sunFar.gpu.adopt(shared, false);
    grantCapability(rt);
    return publish(rt);
  }
  if (sunFar.pending || sunFar.reason) return;
  if (!context.readSceneProxy) {
    sunFar.reason = 'ombre lointaine indisponible : le cache ne porte pas de proxy résident';
    return publish(rt);
  }
  sunFar.pending = context
    .readSceneProxy()
    .then((proxy: SceneProxy) => {
      sunFar.gpu?.adopt(createGpuBounceProxy(device, proxy), true);
      grantCapability(rt);
      publish(rt);
    })
    .catch((error: unknown) => {
      sunFar.reason = `ombre lointaine indisponible : proxy résident illisible (${String(error)})`;
      rt.diag.diagnosticFailure('sun-far-shadow-unavailable', error);
      publish(rt);
    });
}

function grantCapability(rt: WebgpuPagesRuntime) {
  rt.capabilities.unsupported = rt.capabilities.unsupported.filter(
    (item) => item !== SUN_FAR_CAPABILITY,
  );
}

/** Ce que l'ombre lointaine a réellement obtenu. Jamais une estimation, jamais un zéro déduit. */
function publish(rt: WebgpuPagesRuntime) {
  const { sunFar, diag } = rt,
    // Le module gréé, et seulement une fois son proxy adopté : sans proxy, ses réglages ne
    // décrivent aucun rayon, et c'est `null` qu'il faut publier, pas le zéro de leur naissance.
    ready = sunFar.gpu?.proxy ? sunFar.gpu : undefined,
    proxy = ready?.proxy;
  if (sunFar.published && !proxy) return;
  sunFar.published = true;
  diag.engineDiagnostic('sun-far-shadow', 'Ombres lointaines du soleil contre le proxy', {
    version: 1,
    beyondFraction: LIGHT_SETTINGS.sunShadowFarFraction,
    cascadeRatioMax: LIGHT_SETTINGS.sunCascadeRatioMax,
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

/** L'état de l'ombre lointaine, tel que le profil par étape et le suivi de l'image le publient. */
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
 * Les compteurs de l'étape « Ombres lointaines », ceux qui sont revenus seulement : un relevé qui
 * n'est pas revenu n'est pas déposé du tout, il n'existe pas de zéro déduit.
 */
export function sunFarCounts(rt: WebgpuPagesRuntime) {
  const { proxyTriangles, pixelsTestes, pixelsAssombris, imageRelevee } = sunFarState(rt);
  const releves = { trianglesDuProxy: proxyTriangles, pixelsTestes, pixelsAssombris, imageRelevee };
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(releves)) if (value !== null) counts[name] = value;
  return counts;
}
