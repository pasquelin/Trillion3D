/**
 * Le scope de validation d'un appareil, ouvert autour d'une création de ressource. Chaque voie de
 * création le poussait et le relisait avec sa propre garde de compatibilité ; elles partagent ces
 * trois gestes, et la garde n'est écrite qu'une fois. Un appareil qui ne sait pas ouvrir de scope ne
 * prouve aucune erreur : rien n'est refusé de ce fait, et l'appelant garde la voie qu'il aurait
 * gardée.
 */
export function openValidation(device: GPUDevice) {
  if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
}

/** Ferme le scope et rend ce que l'appareil a refusé depuis son ouverture, ou rien. */
export async function validationError(device: GPUDevice) {
  return typeof device.popErrorScope === 'function' ? await device.popErrorScope() : null;
}

/** Ferme le scope sans rien en lire : la voie de repli est déjà décidée. */
export async function dropValidation(device: GPUDevice) {
  await validationError(device).catch(() => {});
}
