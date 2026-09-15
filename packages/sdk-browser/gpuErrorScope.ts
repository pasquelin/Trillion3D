/**
 * Le scope de validation d'un appareil, ouvert autour d'une création de ressource. Trois voies le
 * poussaient et le relisaient chacune avec la même garde de compatibilité ; elles partagent ces
 * trois gestes. Un appareil qui ne sait pas ouvrir de scope ne prouve aucune erreur : rien n'est
 * refusé de ce fait, et l'appelant garde la voie qu'il aurait gardée.
 */
export function openValidation(device: GPUDevice) {
  if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
}

/** Ferme le scope sans rien en lire : la voie de repli est déjà décidée. */
export async function dropValidation(device: GPUDevice) {
  if (typeof device.popErrorScope === 'function') await device.popErrorScope().catch(() => {});
}

/** Ferme le scope et dit si l'appareil a refusé quelque chose depuis son ouverture. */
export async function validationFailed(device: GPUDevice) {
  if (typeof device.popErrorScope !== 'function') return false;
  return !!(await device.popErrorScope());
}
