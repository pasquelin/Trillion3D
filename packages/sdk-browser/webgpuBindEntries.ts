import type { WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { WebgpuAtlasSlots } from './webgpuAtlasSlots.ts';
import {
  BLEND_BINDINGS,
  SHADE_BINDINGS,
  SMALL_BINDINGS,
  VIS_BINDINGS,
} from './webgpuBindLayout.ts';

/** Ce que toute passe qui échantillonne un atlas a besoin de lier : ses classes et la table des
 *  slots, qui dit pour chaque texture sa classe, sa couche et jusqu'où ses mips sont résidents. */
type AtlasResources = { colorAtlas: WebgpuAtlas; sampler: GPUSampler; slots: WebgpuAtlasSlots };

/** Les ressources d'un groupe de la passe de visibilité : celles qui changent d'un constructeur à
 *  l'autre sont l'uniforme (son décalage de slot), les drapeaux Hi-Z et les deux tampons de slots,
 *  qui valent `zeroFlags` pour le chemin direct et les tampons indirects pour le chemin par slot. */
export type VisBindResources = AtlasResources & {
  cache: GPUBuffer;
  position: GPUBuffer;
  pageTable: GPUBuffer;
  flags: GPUBuffer;
  uniform: GPUBuffer;
  uniformOffset: number;
  uv: GPUBuffer;
  instances: GPUBuffer;
  slotOffsets: GPUBuffer;
};

/** Les ressources du groupe de résolution matérielle, identiques pour ses deux constructeurs. */
export type ShadeBindResources = AtlasResources & {
  visView: GPUTextureView;
  cache: GPUBuffer;
  position: GPUBuffer;
  uv: GPUBuffer;
  normal: GPUBuffer;
  pageTable: GPUBuffer;
  uniform: GPUBuffer;
  dataAtlas: WebgpuAtlas;
};

/**
 * L'éclairage que lit un maillage transparent : les lampes déclarées du contrat, leurs tranches
 * d'ombre, l'atlas et son échantillonneur, la grille de sondes et ses coefficients. Ce sont les
 * ressources de la résolution opaque, jamais une lumière propre au mélange (P6) ; celles qui
 * n'existent pas encore sont tenues par les remplaçants de la résolution différée.
 */
export type BlendLighting = {
  directLights: GPUBuffer;
  shadowSlices: GPUBuffer;
  shadowAtlas: GPUTextureView;
  shadowSampler: GPUSampler;
  bounceGrid: GPUBuffer;
  probes: GPUBuffer;
  /** Les listes de lampes par tuile : la passe de mélange lit la tranche qui la concerne. */
  tileLights: GPUBuffer;
};

/** Les ressources du groupe d'un maillage transparent : le maillage lui-même et la scène. */
export type BlendBindResources = AtlasResources &
  BlendLighting & {
    indices: GPUBuffer;
    positions: GPUBuffer;
    uvs: GPUBuffer;
    uniform: GPUBuffer;
    uniformSize: number;
    dataAtlas: WebgpuAtlas;
    normals: GPUBuffer;
    scales: GPUBuffer;
    /** Identité d'un cluster transparent, une par entrée de la table de dessin. */
    clusterDiagnostic: GPUBuffer;
    /** La liste compactée des clusters à dessiner, et la portée de chacun dans le cache de pages. */
    clusterIds: GPUBuffer;
    clusterSpans: GPUBuffer;
    /** Le volume du matériau, à décalage dynamique comme l'uniforme principal. */
    volume: GPUBuffer;
    volumeSize: number;
    /** Le fond figé de la passe de transmission : couleur et profondeur déjà dessinées. */
    backdrop: GPUTextureView;
    backdropDepth: GPUTextureView;
  };

/** Les ressources du raster logiciel des petits triangles : il ne lit que la découpe alpha. */
export type SmallBindResources = AtlasResources & {
  indices: GPUBuffer;
  positions: GPUBuffer;
  pages: GPUBuffer;
  hizFlags: GPUBuffer;
  uniform: GPUBuffer;
  uniformSize: number;
  uvs: GPUBuffer;
  /** L'image du raster puis, juste après elle, la liste des petits triangles. */
  work: GPUBuffer;
  selectionMask: GPUBuffer;
};

/** Une entrée de texture par classe d'atlas, aux liaisons que la disposition leur donne. */
const atlasEntries = (bindings: readonly number[], atlas: WebgpuAtlas): GPUBindGroupEntry[] =>
  bindings.map((binding, index) => ({ binding, resource: atlas.classes[index].view }));

/** L'unique liste d'entrées de `visBindGroupLayout`. Ses deux constructeurs — le groupe direct et
 *  celui d'un slot indirect — passent par ici, si bien qu'une liaison ajoutée à la disposition ne
 *  peut plus manquer à l'un des deux. */
export function visBindEntries(r: VisBindResources): GPUBindGroupEntry[] {
  const b = VIS_BINDINGS;
  return [
    { binding: b.cache, resource: { buffer: r.cache } },
    { binding: b.position, resource: { buffer: r.position } },
    { binding: b.pageTable, resource: { buffer: r.pageTable } },
    { binding: b.flags, resource: { buffer: r.flags } },
    { binding: b.uniform, resource: { buffer: r.uniform, offset: r.uniformOffset, size: 96 } },
    { binding: b.uv, resource: { buffer: r.uv } },
    ...atlasEntries(b.maps, r.colorAtlas),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.instances, resource: { buffer: r.instances } },
    { binding: b.slotOffsets, resource: { buffer: r.slotOffsets } },
    { binding: b.colorSlots, resource: { buffer: r.slots.color } },
  ];
}

/** L'unique liste d'entrées de `shadeBindGroupLayout`, partagée par la construction de préparation
 *  et par la reconstruction après changement de tampon. */
export function shadeBindEntries(r: ShadeBindResources): GPUBindGroupEntry[] {
  const b = SHADE_BINDINGS;
  return [
    { binding: b.visView, resource: r.visView },
    { binding: b.cache, resource: { buffer: r.cache } },
    { binding: b.position, resource: { buffer: r.position } },
    { binding: b.uv, resource: { buffer: r.uv } },
    { binding: b.normal, resource: { buffer: r.normal } },
    { binding: b.pageTable, resource: { buffer: r.pageTable } },
    ...atlasEntries(b.maps, r.colorAtlas),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.uniform, resource: { buffer: r.uniform } },
    ...atlasEntries(b.dataMaps, r.dataAtlas),
    { binding: b.colorSlots, resource: { buffer: r.slots.color } },
    { binding: b.dataSlots, resource: { buffer: r.slots.data } },
  ];
}

/** L'unique liste d'entrées de `blendBindGroupLayout`. */
export function blendBindEntries(r: BlendBindResources): GPUBindGroupEntry[] {
  const b = BLEND_BINDINGS;
  return [
    { binding: b.indices, resource: { buffer: r.indices } },
    { binding: b.positions, resource: { buffer: r.positions } },
    { binding: b.uvs, resource: { buffer: r.uvs } },
    { binding: b.uniform, resource: { buffer: r.uniform, size: r.uniformSize } },
    ...atlasEntries(b.maps, r.colorAtlas),
    { binding: b.sampler, resource: r.sampler },
    ...atlasEntries(b.dataMaps, r.dataAtlas),
    { binding: b.normals, resource: { buffer: r.normals } },
    { binding: b.scales, resource: { buffer: r.scales } },
    { binding: b.directLights, resource: { buffer: r.directLights } },
    { binding: b.clusterDiagnostic, resource: { buffer: r.clusterDiagnostic } },
    { binding: b.colorSlots, resource: { buffer: r.slots.color } },
    { binding: b.dataSlots, resource: { buffer: r.slots.data } },
    { binding: b.clusterIds, resource: { buffer: r.clusterIds } },
    { binding: b.clusterSpans, resource: { buffer: r.clusterSpans } },
    { binding: b.shadowSlices, resource: { buffer: r.shadowSlices } },
    { binding: b.shadowAtlas, resource: r.shadowAtlas },
    { binding: b.shadowSampler, resource: r.shadowSampler },
    { binding: b.bounceGrid, resource: { buffer: r.bounceGrid } },
    { binding: b.probes, resource: { buffer: r.probes } },
    { binding: b.tileLights, resource: { buffer: r.tileLights } },
    { binding: b.volume, resource: { buffer: r.volume, size: r.volumeSize } },
    { binding: b.backdrop, resource: r.backdrop },
    { binding: b.backdropDepth, resource: r.backdropDepth },
  ];
}

/** L'unique liste d'entrées du groupe de calcul des petits triangles. */
export function smallBindEntries(r: SmallBindResources): GPUBindGroupEntry[] {
  const b = SMALL_BINDINGS;
  return [
    { binding: b.indices, resource: { buffer: r.indices } },
    { binding: b.positions, resource: { buffer: r.positions } },
    { binding: b.pages, resource: { buffer: r.pages } },
    { binding: b.hizFlags, resource: { buffer: r.hizFlags } },
    { binding: b.uniform, resource: { buffer: r.uniform, offset: 0, size: r.uniformSize } },
    { binding: b.uvs, resource: { buffer: r.uvs } },
    ...atlasEntries(b.maps, r.colorAtlas),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.work, resource: { buffer: r.work } },
    { binding: b.selectionMask, resource: { buffer: r.selectionMask } },
    { binding: b.colorSlots, resource: { buffer: r.slots.color } },
  ];
}
