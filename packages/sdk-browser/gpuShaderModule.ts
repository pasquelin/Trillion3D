import { dropValidation } from './gpuErrorScope.ts';

/**
 * Les erreurs de compilation d'un module de nuanceur. Un appareil qui ne sait pas rendre ces
 * messages ne prouve aucune erreur : la liste est alors vide, et l'appelant garde la voie qu'il
 * aurait gardée.
 */
export async function shaderErrors(module: GPUShaderModule) {
  const info = await module.getCompilationInfo?.();
  return info ? info.messages.filter((message) => message.type === 'error') : [];
}

/**
 * Un module dont la compilation est vérifiée avant le premier pipeline : une erreur porte toujours le
 * nom du nuanceur qui l'a produite plutôt qu'une pile anonyme.
 */
export async function createCheckedShaderModule(device: GPUDevice, code: string, label: string) {
  const module = device.createShaderModule({ label, code });
  const errors = await shaderErrors(module);
  if (errors.length)
    throw new Error(`${label}: ${errors.map((error) => error.message).join('\n')}`);
  return module;
}

/**
 * Vrai quand le module n'a pas compilé. Le scope de validation ouvert autour de la compilation est
 * alors refermé ici : les trois voies qui rendent une solution de repli le fermaient chacune de la
 * même façon avant de sortir. À l'appelant de ne garder que son propre nettoyage.
 */
export async function shaderFailed(device: GPUDevice, module: GPUShaderModule) {
  if (!(await shaderErrors(module)).length) return false;
  await dropValidation(device);
  return true;
}
