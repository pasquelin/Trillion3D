/**
 * Les erreurs de compilation d'un module de nuanceur. Cinq passes répétaient le même filtrage des
 * messages ; il n'en reste qu'un. Un appareil qui ne sait pas rendre ces messages ne prouve aucune
 * erreur : la liste est alors vide, et l'appelant garde la voie qu'il aurait gardée.
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
