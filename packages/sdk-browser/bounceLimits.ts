/**
 * Ce que le rebond va demander à l'appareil, confronté à ce que l'appareil déclare pouvoir tenir.
 *
 * Une liaison plus grande qu'une limite n'échoue pas là où elle est écrite : le tampon naît
 * invalide, l'erreur remonte sans être capturée, et c'est la première image qui lie le groupe qui
 * perd l'appareil — loin de la cause. Les tailles sont donc toutes calculées avant qu'un seul
 * tampon ne soit créé, comparées à `device.limits`, et une scène trop grande pour cet appareil se
 * voit refuser le rebond avec la mesure qui a manqué, jamais avec une devinette.
 */

import type { SceneProxy } from '../sdk-core/index.ts';
import { PROXY_HEADER_BYTES } from './bounceNodeWgsl.ts';
import { surfaceCacheBytes } from './bounceSurfaceWgsl.ts';
import { BOUNCE_GRID_BYTES } from './bounceUniform.ts';

/** Une liaison prévue : son nom dans le diagnostic, ses octets, et la limite qui la borne. */
type BounceBinding = {
  name: string;
  bytes: number;
  limit: 'maxStorageBufferBindingSize' | 'maxUniformBufferBindingSize';
};

/**
 * Le premier dépassement, écrit en clair, ou `null` quand tout tient. L'ordre des liaisons est
 * celui de leur création : le message nomme la première qui ne passe pas, pas la plus grosse.
 */
function bounceLimitFailure(device: GPUDevice, bindings: readonly BounceBinding[]) {
  const { limits } = device;
  for (const { name, bytes, limit } of bindings) {
    if (bytes > limits[limit])
      return `bounce binding "${name}" needs ${bytes} bytes, over this device's ${limit} of ${limits[limit]}`;
    if (bytes > limits.maxBufferSize)
      return `bounce buffer "${name}" needs ${bytes} bytes, over this device's maxBufferSize of ${limits.maxBufferSize}`;
  }
  return null;
}

/**
 * Les octets du proxy résident : son entête, puis ses trois colonnes bout à bout dans le tampon
 * unique que la traversée lie. Un proxy sans données garde les quatre mots de la liaison vide.
 */
function residentProxyBytes(proxy: SceneProxy) {
  const data = proxy.data;
  const columns =
    (data?.triangles.byteLength ?? 0) +
    (data?.nodeBounds.byteLength ?? 0) +
    (data?.nodeChildren.byteLength ?? 0);
  return PROXY_HEADER_BYTES + Math.max(16, columns);
}

/**
 * Les octets de chaque liaison que le rebond va créer, dans l'ordre où il les crée : le proxy
 * résident et son albédo, les deux copies des sondes, la file de l'image, le cache de surfaces et
 * l'uniforme des cascades.
 */
function plannedBindings(
  proxy: SceneProxy,
  probeBytes: number,
  queueBytes: number,
): BounceBinding[] {
  const data = proxy.data,
    storage = 'maxStorageBufferBindingSize';
  return [
    { name: 'resident proxy', bytes: residentProxyBytes(proxy), limit: storage },
    { name: 'proxy albedo', bytes: data?.albedo.byteLength ?? 4, limit: storage },
    { name: 'probes', bytes: probeBytes, limit: storage },
    { name: 'probes snapshot', bytes: probeBytes, limit: storage },
    { name: 'probe queue', bytes: queueBytes, limit: storage },
    { name: 'surface cache', bytes: surfaceCacheBytes(proxy.triangles), limit: storage },
    { name: 'cascades uniform', bytes: BOUNCE_GRID_BYTES, limit: 'maxUniformBufferBindingSize' },
  ];
}

/**
 * Refuse le rebond avant qu'un seul tampon ne soit créé quand cet appareil ne peut pas le tenir.
 * L'appelant remonte le message tel quel : c'est lui qui dit quelle liaison a manqué et de combien.
 */
export function ensureBounceFits(
  device: GPUDevice,
  proxy: SceneProxy,
  probeBytes: number,
  queueBytes: number,
) {
  const failure = bounceLimitFailure(device, plannedBindings(proxy, probeBytes, queueBytes));
  if (failure) throw new Error(failure);
}
