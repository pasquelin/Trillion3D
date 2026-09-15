import type { WebgpuPreviewAtlas } from './webgpuPreviewAtlas.ts';

/** Les ressources d'un groupe de la passe de visibilité : celles qui changent d'un constructeur à
 *  l'autre sont l'uniforme (son décalage de slot), les drapeaux Hi-Z et les deux tampons de slots,
 *  qui valent `zeroFlags` pour le chemin direct et les tampons indirects pour le chemin par slot. */
export type VisBindResources = {
  cache: GPUBuffer;
  position: GPUBuffer;
  pageTable: GPUBuffer;
  flags: GPUBuffer;
  uniform: GPUBuffer;
  uniformOffset: number;
  uv: GPUBuffer;
  maps: GPUTextureView;
  sampler: GPUSampler;
  instances: GPUBuffer;
  slotOffsets: GPUBuffer;
  preview: WebgpuPreviewAtlas;
};

/** Les ressources du groupe de résolution matérielle, identiques pour ses deux constructeurs. */
export type ShadeBindResources = {
  visView: GPUTextureView;
  cache: GPUBuffer;
  position: GPUBuffer;
  uv: GPUBuffer;
  normal: GPUBuffer;
  pageTable: GPUBuffer;
  maps: GPUTextureView;
  sampler: GPUSampler;
  uniform: GPUBuffer;
  dataMaps: GPUTextureView;
  preview: WebgpuPreviewAtlas;
};

/** L'unique liste d'entrées de `visBindGroupLayout`. Ses deux constructeurs — le groupe direct et
 *  celui d'un slot indirect — passent par ici, si bien qu'une liaison ajoutée à la disposition ne
 *  peut plus manquer à l'un des deux. */
export function visBindEntries(r: VisBindResources): GPUBindGroupEntry[] {
  return [
    { binding: 0, resource: { buffer: r.cache } },
    { binding: 1, resource: { buffer: r.position } },
    { binding: 2, resource: { buffer: r.pageTable } },
    { binding: 3, resource: { buffer: r.flags } },
    { binding: 4, resource: { buffer: r.uniform, offset: r.uniformOffset, size: 96 } },
    { binding: 5, resource: { buffer: r.uv } },
    { binding: 6, resource: r.maps },
    { binding: 7, resource: r.sampler },
    { binding: 8, resource: { buffer: r.instances } },
    { binding: 9, resource: { buffer: r.slotOffsets } },
    { binding: 10, resource: r.preview.view },
    { binding: 11, resource: { buffer: r.preview.ready } },
  ];
}

/** L'unique liste d'entrées de `shadeBindGroupLayout`, partagée par la construction de préparation
 *  et par la reconstruction après changement de tampon. */
export function shadeBindEntries(r: ShadeBindResources): GPUBindGroupEntry[] {
  return [
    { binding: 0, resource: r.visView },
    { binding: 1, resource: { buffer: r.cache } },
    { binding: 2, resource: { buffer: r.position } },
    { binding: 3, resource: { buffer: r.uv } },
    { binding: 4, resource: { buffer: r.normal } },
    { binding: 5, resource: { buffer: r.pageTable } },
    { binding: 6, resource: r.maps },
    { binding: 7, resource: r.sampler },
    { binding: 8, resource: { buffer: r.uniform } },
    { binding: 9, resource: r.dataMaps },
    { binding: 10, resource: r.preview.view },
    { binding: 11, resource: { buffer: r.preview.ready } },
  ];
}
