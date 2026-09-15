import { SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';

/**
 * Les liaisons de la passe différée. La vue sans éclairage s'arrête aux surfaces et à l'uniforme ;
 * le programme du contrat ajoute les lampes déclarées, leurs listes par tuile, leurs tranches
 * d'ombre et l'atlas ; celui du rebond y ajoute la grille de sondes. Aucun des trois ne lit de
 * lumière écrite dans la scène : il n'y en a plus.
 */
export function createDeferredLayouts(device: GPUDevice, direct: boolean, bounce = false) {
  const entries: GPUBindGroupLayoutEntry[] = [0, 1, 2, 3, 4].map((binding) => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: {
      sampleType: binding === 3 ? 'uint' : binding === 4 ? 'depth' : 'unfilterable-float',
    },
  }));
  entries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
  if (direct)
    entries.push(
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    );
  // La grille de sondes et leurs coefficients : liées seulement par le programme du rebond, si
  // bien qu'une session sans rebond garde exactement la disposition d'avant.
  if (bounce)
    entries.push(
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    );
  return {
    lighting: device.createBindGroupLayout({ entries }),
    composition: device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    }),
  };
}

/**
 * Les ressources de remplacement du contrat : une liste de tuiles vide, une tranche d'ombre invalide
 * et un atlas d'un texel. Un appareil qui refuse le vrai atlas garde ainsi des liaisons valides, et
 * la lampe reste simplement sans ombre au lieu de faire échouer l'image.
 */
export function createDeferredPlaceholders(device: GPUDevice) {
  const tiles = device.createBuffer({
    label: 'WG empty light tiles',
    size: 256,
    usage: GPUBufferUsage.STORAGE,
  });
  const slices = device.createBuffer({
    label: 'WG empty shadow slices',
    size: SHADOW_SLICE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const atlas = device.createTexture({
    label: 'WG empty shadow atlas',
    size: [1, 1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const sampler = device.createSampler({
    label: 'WG shadow comparison',
    compare: 'less',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  return {
    tiles,
    slices,
    atlasView: atlas.createView(),
    sampler,
    dispose() {
      tiles.destroy();
      slices.destroy();
      atlas.destroy();
    },
  };
}
