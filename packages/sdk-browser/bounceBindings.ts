/**
 * Les liaisons des passes de calcul du rebond, décrites par leur seul type.
 *
 * Les deux passes — cache de surfaces et sondes — lisent les mêmes colonnes du proxy aux mêmes
 * rangs : une seule façon de décrire une liaison évite que les deux nuanceurs et les deux groupes
 * dérivent l'un de l'autre. Un rang laissé vide n'est pas déclaré du tout : une passe qui n'a plus
 * besoin des lampes ne les lie pas.
 */

/** La disposition d'une passe : un type par rang, `null` pour un rang que la passe n'utilise pas. */
export function bounceLayout(device: GPUDevice, types: (GPUBufferBindingType | null)[]) {
  return device.createBindGroupLayout({
    entries: types.flatMap((type, binding) =>
      type ? [{ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } }] : [],
    ),
  });
}

/** Le groupe correspondant : un tampon par rang déclaré, dans le même ordre. */
export function bounceGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  buffers: (GPUBuffer | null)[],
) {
  return device.createBindGroup({
    layout,
    entries: buffers.flatMap((buffer, binding) =>
      buffer ? [{ binding, resource: { buffer } }] : [],
    ),
  });
}
