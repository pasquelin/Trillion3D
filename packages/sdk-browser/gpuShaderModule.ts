/**
 * Un module de nuanceur dont la compilation est vérifiée avant le premier pipeline. Trois passes
 * répétaient le même filtrage des messages d'erreur ; il n'en reste qu'un, et une erreur de
 * compilation porte toujours le nom du nuanceur qui l'a produite plutôt qu'une pile anonyme.
 */
export async function createCheckedShaderModule(device: GPUDevice, code: string, label: string) {
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo?.();
  const errors = info?.messages.filter((message) => message.type === 'error');
  if (errors?.length)
    throw new Error(`${label}: ${errors.map((error) => error.message).join('\n')}`);
  return module;
}
