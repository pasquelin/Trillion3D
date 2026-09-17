import { ATLAS_CLASS_COUNT } from './webgpuAtlasClasses.ts';

/**
 * Les numéros de liaison des quatre dispositions du chemin WebGPU, unique source de vérité : la
 * disposition elle-même, le code WGSL qui déclare ses variables et la liste d'entrées de son
 * constructeur les lisent tous ici. Ajouter une classe d'atlas décale donc les numéros des trois
 * côtés à la fois, et jamais d'un seul — le défaut que la fusion des lots 1 et 2 a coûté.
 */
/** Les liaisons d'un atlas, une par classe de taille, contiguës depuis `first`. */
const classes = (first: number) =>
  Array.from({ length: ATLAS_CLASS_COUNT }, (_, index) => first + index);

/** Les deux formes de liaison que les dispositions répètent, écrites une fois pour toutes. */
export const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };
export const atlasLayoutEntry = (
  binding: number,
  visibility = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry => ({
  binding,
  visibility,
  texture: { sampleType: 'float', viewDimension: '2d-array' },
});

export const VIS_BINDINGS = (() => {
  const maps = classes(6),
    after = 6 + ATLAS_CLASS_COUNT;
  return {
    cache: 0,
    position: 1,
    pageTable: 2,
    flags: 3,
    uniform: 4,
    uv: 5,
    maps,
    sampler: after,
    instances: after + 1,
    slotOffsets: after + 2,
    colorSlots: after + 3,
  };
})();

export const SHADE_BINDINGS = (() => {
  const maps = classes(6),
    after = 6 + ATLAS_CLASS_COUNT;
  return {
    visView: 0,
    cache: 1,
    position: 2,
    uv: 3,
    normal: 4,
    pageTable: 5,
    maps,
    sampler: after,
    uniform: after + 1,
    dataMaps: classes(after + 2),
    colorSlots: after + 2 + ATLAS_CLASS_COUNT,
    dataSlots: after + 3 + ATLAS_CLASS_COUNT,
  };
})();

export const BLEND_BINDINGS = (() => {
  const maps = classes(4),
    after = 4 + ATLAS_CLASS_COUNT;
  const rest = after + 1 + ATLAS_CLASS_COUNT;
  return {
    indices: 0,
    positions: 1,
    uvs: 2,
    uniform: 3,
    maps,
    sampler: after,
    dataMaps: classes(after + 1),
    normals: rest,
    scales: rest + 1,
    /** Les lampes déclarées du contrat, celles-là mêmes que relit la résolution opaque (P6). */
    directLights: rest + 2,
    clusterDiagnostic: rest + 3,
    colorSlots: rest + 4,
    dataSlots: rest + 5,
    /** La liste d'instances que l'étalement du plan a écrite : deux mots par instance, l'item qui
     *  la porte et ce qu'elle dessine (`webgpuBlendExpandWgsl.ts`). */
    planInstances: rest + 6,
    clusterSpans: rest + 7,
    /** Les tranches d'ombre, leur atlas et l'échantillonneur de comparaison qui les lit. */
    shadowSlices: rest + 8,
    shadowAtlas: rest + 9,
    shadowSampler: rest + 10,
    /** La grille de sondes et leurs coefficients : l'irradiance de l'opaque, sans passe de plus. */
    bounceGrid: rest + 11,
    probes: rest + 12,
    /** Le volume du matériau transmissif, et le fond figé que sa passe relit : la couleur et la
     *  profondeur déjà dessinées, copiées avant elle. Liées pour tout item, lues par le seul
     *  fragment qui porte le drapeau de transmission. */
    volume: rest + 13,
    backdrop: rest + 14,
    backdropDepth: rest + 15,
    /** Les listes de lampes par tuile, celles-là mêmes que lit la résolution opaque : la passe de
     *  mélange y lit sa propre tranche de profondeur, du plan proche au fond opaque. */
    tileLights: rest + 16,
    /** Le proxy résident, celui-là même que traverse la résolution opaque : l'ombre du soleil
     *  au-delà de la dernière cascade se tire ici par le même rayon, sur une seule liaison. */
    proxy: rest + 17,
    /** Les paramètres de chaque item transparent, indexés par son rang dans la scène : la matrice
     *  monde, la couleur, les six cartes et leurs facteurs. Ils ne dépendent pas de l'image, si
     *  bien qu'un appel n'a plus ni décalage dynamique ni groupe de liaison à lui. */
    items: rest + 18,
  };
})();

/**
 * Le raster logiciel tient tout entier dans l'étage de calcul, où WebGPU ne garantit que huit
 * tampons de stockage : l'image et la liste des petits triangles vivent donc dans un seul tampon,
 * `work`, l'image d'abord et la liste juste après elle. Une liaison de moins, et le compte tient.
 */
export const SMALL_BINDINGS = (() => {
  const maps = classes(6),
    after = 6 + ATLAS_CLASS_COUNT;
  return {
    indices: 0,
    positions: 1,
    pages: 2,
    hizFlags: 3,
    uniform: 4,
    uvs: 5,
    maps,
    sampler: after,
    work: after + 1,
    selectionMask: after + 2,
    colorSlots: after + 3,
  };
})();
