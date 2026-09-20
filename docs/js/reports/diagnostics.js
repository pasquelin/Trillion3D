/** Domain groups stay explicit: these counters are not interchangeable memory totals. */
export const DIAGNOSTICS = [
  {
    title: ['Shadows and indirect lighting', 'Ombres et éclairage indirect'],
    fields: [
      ['stage:shadows:pagesRedessinees', 'Redrawn shadow pages', 'Pages d’ombre redessinées', ''],
      ['stage:shadows:pagesEnAttente', 'Pending shadow pages', 'Pages d’ombre en attente', ''],
      ['stage:shadows:retardMaxMs', 'Maximum shadow delay', 'Retard maximal des ombres', 'ms'],
      ['stage:bounce:sondesMisesAJour', 'Updated probes', 'Sondes mises à jour', ''],
      ['stage:bounce:rayonsParImage', 'Rays per frame', 'Rayons par image', ''],
    ],
  },
  {
    title: ['Residency and streaming', 'Résidence et streaming'],
    fields: [
      ['budgetPages.residentes', 'Resident pages', 'Pages résidentes', ''],
      ['budgetPages.demande', 'Requested pages', 'Pages demandées', ''],
      ['metrics.texturePending', 'Pending textures', 'Textures en attente', ''],
      ['metrics.textureEvictions', 'Evicted textures', 'Textures évincées', ''],
      ['metrics.gpuAllocatedBytes', 'Tracked GPU allocations', 'Allocations GPU suivies', 'bytes'],
    ],
  },
  {
    title: ['Lighting and image work', 'Éclairage et travail de rendu'],
    fields: [
      ['metrics.lightsActive', 'Active lights', 'Lumières actives', ''],
      [
        'totalSubmittedTriangles',
        'Submitted triangles, all passes',
        'Triangles soumis, toutes passes',
        '',
      ],
      ['submittedTriangles', 'Submitted opaque triangles', 'Triangles opaques soumis', ''],
      [
        'metrics.hizRejectedTriangles',
        'Occlusion-rejected triangles',
        'Triangles rejetés par occlusion',
        '',
      ],
      ['metrics.pagesDecodedWasm', 'Decoded pages (Wasm)', 'Pages décodées (Wasm)', ''],
    ],
  },
];
export function diagnosticValue(record, path) {
  if (path.startsWith('stage:')) {
    const [, stage, key] = path.split(':');
    const value = record?.data.profilParEtape?.stages?.find((item) => item.stage === stage)
      ?.counts?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  const value = path.split('.').reduce((item, key) => item?.[key], record?.data);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
