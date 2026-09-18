import { TAA_HISTORY_BYTES_PER_PIXEL, createTemporalAntialiasing } from './temporalAntialiasing.ts';
import { dropTaaHistory } from './taaFrame.ts';
import { grantCapability } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Les deux capacités que la passe sert : l'antialiasing, et les vecteurs de mouvement qu'elle
 *  dérive du tampon de visibilité. Non supportées tant qu'elle n'est pas gréée. */
export const TAA_CAPABILITY = 'temporal antialiasing';
export const MOTION_CAPABILITY = 'motion vectors';

/**
 * Grée l'antialiasing temporel, une fois, après l'éclairage différé. L'hôte peut le refuser
 * (`temporalAntialiasing: false`) : rien n'est alors créé, et l'image reste échantillonnée au
 * centre du pixel. Un appareil qui refuse le programme laisse la capacité non supportée et l'image
 * telle qu'avant — jamais une image fausse.
 */
export async function prepareTemporalAntialiasing(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, context, capabilities } = rt;
  if (context.temporalAntialiasing === false) return;
  try {
    gpu.temporal = await createTemporalAntialiasing(device, rt.layout.selectionRoots);
    grantCapability(capabilities, TAA_CAPABILITY);
    grantCapability(capabilities, MOTION_CAPABILITY);
  } catch (error) {
    dropTemporalAntialiasing(rt, error);
  }
}

/** La passe quitte la session : capacités retirées, cause nommée, image telle qu'avant le lot. */
function dropTemporalAntialiasing(rt: WebgpuPagesRuntime, error: unknown) {
  rt.gpu.temporal?.dispose();
  rt.gpu.temporal = undefined;
  rt.capabilities.unsupported.push(TAA_CAPABILITY, MOTION_CAPABILITY);
  rt.diag.diagnosticFailure('temporal-antialiasing-unavailable', error);
}

/**
 * Les cibles d'historique pour la taille de l'image en cours, et leurs octets. Comme le raster de
 * calcul, la passe ne fait jamais refuser une image : si ses cibles n'entrent pas dans le budget
 * avec les autres (`base`), c'est elle qui s'en va, nommément. Une capture de surfaces rend depuis
 * une autre caméra et n'accumule pas : ses cibles ne touchent pas l'historique de la vue, qui
 * reste entier pour l'image qui suit la restauration.
 */
export function ensureTaaTargets(
  rt: WebgpuPagesRuntime,
  width: number,
  height: number,
  base: number,
) {
  const temporal = rt.gpu.temporal;
  if (!temporal) return 0;
  // Sous une capture, la réserve de la capture porte déjà l'historique : il n'est pas compté deux fois.
  if (rt.capture.secondaryCamera) return 0;
  const history = width * height * TAA_HISTORY_BYTES_PER_PIXEL;
  if (base + history > rt.setup.frameBudget) {
    dropTemporalAntialiasing(
      rt,
      new Error(`SURFACE_BUDGET: ${base + history} > ${rt.setup.frameBudget}`),
    );
    return 0;
  }
  if (temporal.resize(width, height)) dropTaaHistory(rt);
  return history;
}
