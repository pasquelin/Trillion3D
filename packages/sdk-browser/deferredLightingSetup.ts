import { PROBE_FLOATS, SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';
import { BOUNCE_GRID_BYTES } from './bounceUniform.ts';
import { PROXY_HEADER_BYTES } from './bounceNodeWgsl.ts';
import { SUN_FAR_PROXY_BINDING } from './sunFarShadowWgsl.ts';

/**
 * Le remplaçant du proxy résident : un entête de zéros et quatre mots derrière lui. La présence y
 * vaut zéro, le nombre de nœuds aussi, donc aucun rayon d'ombre lointaine n'est tiré et la surface
 * lointaine reste éclairée exactement comme avant que ce rayon existe.
 */
const PLACEHOLDER_PROXY_BYTES = PROXY_HEADER_BYTES + 16;

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
      // Le proxy résident de l'ombre lointaine du soleil : une seule liaison, qui porte à la fois
      // les colonnes qu'un rayon traverse, les réglages de ce rayon et les deux compteurs de
      // l'image relevée. C'est ce qui permet à la passe de mélange de la lier aussi.
      {
        binding: SUN_FAR_PROXY_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'storage' },
      },
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
 * Les ressources de remplacement du contrat : une liste de tuiles vide, une tranche d'ombre invalide,
 * un atlas d'un texel, et une grille de sondes à zéro. Un appareil qui refuse le vrai atlas garde
 * ainsi des liaisons valides, et la lampe reste simplement sans ombre au lieu de faire échouer
 * l'image ; une image sans rebond lit une grille dont le compte de sondes est nul, donc une
 * irradiance indirecte exactement nulle. La passe de mélange emprunte les mêmes remplaçants : une
 * seule définition de ce que vaut une ressource absente.
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
  // Le remplaçant porte la taille de `BounceGrid`, lue là où la structure est écrite : une liaison
  // plus petite que ce que le nuanceur déclare est refusée par la validation, et l'appareil est
  // perdu. À zéro, le compte de sondes l'est aussi et `sampleBounce` sort sans lire un coefficient ;
  // le tampon de sondes tient une sonde entière, pour que sa taille aussi suive la structure.
  const bounceGrid = device.createBuffer({
    label: 'WG empty bounce grid',
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM,
  });
  const probes = device.createBuffer({
    label: 'WG empty bounce probes',
    size: PROBE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  // Le proxy absent : un entête de zéros, que le nuanceur lit comme un arbre sans nœud et comme une
  // ombre lointaine absente. Les deux passes qui éclairent lient le même, si bien qu'une session
  // sans proxy rend exactement la même image sur l'opaque et sur le mélange.
  const proxy = device.createBuffer({
    label: 'WG empty resident proxy',
    size: PLACEHOLDER_PROXY_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  return {
    tiles,
    slices,
    atlasView: atlas.createView(),
    sampler,
    bounceGrid,
    probes,
    proxy,
    dispose() {
      tiles.destroy();
      slices.destroy();
      atlas.destroy();
      bounceGrid.destroy();
      probes.destroy();
      proxy.destroy();
    },
  };
}
