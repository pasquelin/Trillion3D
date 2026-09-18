/**
 * Les numéros de liaison des quatre dispositions du chemin WebGPU, unique source de vérité : la
 * disposition elle-même, le code WGSL qui déclare ses variables et la liste d'entrées de son
 * constructeur les lisent tous ici. Une liaison ajoutée à un atlas décale donc les numéros des
 * trois côtés à la fois, et jamais d'un seul — le défaut que la fusion des lots 1 et 2 a coûté.
 */
/** Les deux liaisons d'un atlas de textures virtuelles : son pool et sa table de pages. */
const atlas = (pool: number) => ({ pool, pages: pool + 1 });

/** Les deux formes de liaison que les dispositions répètent, écrites une fois pour toutes. */
export const readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' };
export const atlasLayoutEntries = (
  bindings: { pool: number; pages: number },
  visibility = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry[] => [
  {
    binding: bindings.pool,
    visibility,
    texture: { sampleType: 'float', viewDimension: '2d-array' },
  },
  { binding: bindings.pages, visibility, buffer: readOnly },
];
/** Le retour d'image : un tampon de stockage que le pixel incrémente. */
export const feedbackLayoutEntry = (binding: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: GPUShaderStage.FRAGMENT,
  buffer: { type: 'storage' },
});

export const VIS_BINDINGS = {
  cache: 0,
  position: 1,
  pageTable: 2,
  flags: 3,
  uniform: 4,
  uv: 5,
  color: atlas(6),
  sampler: 8,
  instances: 9,
  slotOffsets: 10,
};

export const SHADE_BINDINGS = {
  visView: 0,
  cache: 1,
  position: 2,
  uv: 3,
  normal: 4,
  pageTable: 5,
  color: atlas(6),
  sampler: 8,
  uniform: 9,
  data: atlas(10),
  /** Le retour d'image des textures virtuelles : un compteur par tuile, écrit par le pixel. */
  feedback: 12,
};

export const BLEND_BINDINGS = {
  indices: 0,
  positions: 1,
  uvs: 2,
  uniform: 3,
  color: atlas(4),
  sampler: 6,
  data: atlas(7),
  normals: 9,
  /** Les lampes déclarées du contrat, celles-là mêmes que relit la résolution opaque (P6). */
  directLights: 10,
  clusterDiagnostic: 11,
  /** La liste d'instances que l'étalement du plan a écrite : deux mots par instance, l'item qui
   *  la porte et ce qu'elle dessine (`webgpuBlendExpandWgsl.ts`). */
  planInstances: 12,
  clusterSpans: 13,
  /** Les tranches d'ombre, leur atlas et l'échantillonneur de comparaison qui les lit. */
  shadowSlices: 14,
  shadowAtlas: 15,
  shadowSampler: 16,
  /** La grille de sondes et leurs coefficients : l'irradiance de l'opaque, sans passe de plus. */
  bounceGrid: 17,
  probes: 18,
  /** Le volume du matériau transmissif, et le fond figé que sa passe relit : la couleur et la
   *  profondeur déjà dessinées, copiées avant elle. Liées pour tout item, lues par le seul
   *  fragment qui porte le drapeau de transmission. */
  volume: 19,
  backdrop: 20,
  backdropDepth: 21,
  /** Les listes de lampes par tuile, celles-là mêmes que lit la résolution opaque : la passe de
   *  mélange y lit sa propre tranche de profondeur, du plan proche au fond opaque. */
  tileLights: 22,
  /** Le proxy résident, celui-là même que traverse la résolution opaque : l'ombre du soleil
   *  au-delà de la dernière cascade se tire ici par le même rayon, sur une seule liaison. */
  proxy: 23,
  /** Les paramètres de chaque item transparent, indexés par son rang dans la scène : la matrice
   *  monde, la couleur, les six cartes et leurs facteurs. Ils ne dépendent pas de l'image, si
   *  bien qu'un appel n'a plus ni décalage dynamique ni groupe de liaison à lui. */
  items: 24,
};

/**
 * Le raster logiciel tient tout entier dans l'étage de calcul, où WebGPU ne garantit que huit
 * tampons de stockage : l'image et la liste des petits triangles vivent donc dans un seul tampon,
 * `work`, l'image d'abord et la liste juste après elle. Une liaison de moins, et le compte tient.
 */
export const SMALL_BINDINGS = {
  indices: 0,
  positions: 1,
  pages: 2,
  hizFlags: 3,
  uniform: 4,
  uvs: 5,
  color: atlas(6),
  sampler: 8,
  work: 9,
  selectionMask: 10,
};
