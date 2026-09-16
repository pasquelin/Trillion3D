import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from './gpuBoxProjectWgsl.ts';
import { HIZ_LEVEL_WGSL } from './gpuHizRectWgsl.ts';
import { PARTITION_CLASSIFY_WGSL } from './gpuPartitionClassifyWgsl.ts';
import { PARTITION_PROJECT_WGSL } from './gpuPartitionProjectWgsl.ts';

/**
 * Le module de la partition GPU : trois noyaux sur les mêmes huit tampons de stockage.
 *
 * `projectRows` projette chaque ligne résidente et histogramme sa profondeur ; `chooseSplit` lit cet
 * histogramme et pose la règle de partage de l'image ; `classifyRows` range chaque ligne dans sa
 * moitié, compte son slot indirect et empaquette la boîte testée. Le processeur n'encode que ces
 * trois lancements, dont le nombre ne dépend que du nombre de lignes, et ne relit rien.
 *
 * Huit tampons de stockage exactement, le plafond d'une étape : les bits de reste et les comptes par
 * slot sont ceux de la compaction de dessin, écrits ici plutôt que téléversés, et `flags` est le
 * tampon de verdicts du test Hi-Z, lu seulement — il porte encore ceux de l'image précédente.
 */
export const PARTITION_SHADER = `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}
${PARTITION_UNI_WGSL}@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var<storage, read> items:array<DrawItem>;
@group(0) @binding(2) var<storage, read> flags:array<u32>;
@group(0) @binding(3) var<storage, read_write> rowData:array<u32>;
@group(0) @binding(4) var<storage, read_write> tested:array<u32>;
@group(0) @binding(5) var<storage, read_write> restBits:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> slotUsed:array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> state:array<atomic<u32>>;
@group(0) @binding(8) var<uniform> uni:Uni;
${BOX_PROJECT_WGSL}
${HIZ_LEVEL_WGSL}
${PARTITION_PROJECT_WGSL}
${PARTITION_CLASSIFY_WGSL}
`;
