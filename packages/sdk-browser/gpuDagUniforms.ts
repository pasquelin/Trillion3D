import type { PackedDag } from './gpuDagTypes.ts';
import { selectionListCap } from './gpuDagLayout.ts';
import type { SelectionResult, SelectionUniforms } from './gpuSelection.ts';

/**
 * Les tableaux d'une fente de relecture, réutilisés d'une lecture à l'autre : les rallouer à chaque
 * relecture jetait des dizaines de milliers d'éléments au ramasse-miettes, pour y réécrire
 * exactement les mêmes rangs.
 */
export type DagOutputScratch = { result: SelectionResult; drawable: number[] };
export const createDagOutputScratch = (): DagOutputScratch => ({
  result: { pageIds: [], frustumRejected: 0, lodLevel: 0 },
  drawable: [],
});

export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: SelectionUniforms,
  residentCut: boolean,
) {
  target.fill(0);
  target.set(uniforms.planes, 0);
  target.set(uniforms.view, 24);
  target[40] = uniforms.pixelScale[0];
  target[41] = uniforms.pixelScale[1];
  target[42] = uniforms.pixelError;
  target[43] = uniforms.near;
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length);
  ints[44] = packed.pageCount;
  ints[45] = packed.nodeCount;
  ints[46] = packed.worldCount;
  ints[47] = residentCut ? 1 : 0;
  const cw = uniforms.cameraWorld;
  if (cw) {
    target[48] = cw[0];
    target[49] = cw[1];
    target[50] = cw[2];
  }
  target[51] = uniforms.cameraStretch ?? 1;
  // Le plafond du relevé, que le noyau lit pour borner ses deux moitiés et pour dire, le cas
  // échéant, qu'il a tronqué (`gpuDagLayout.ts`).
  ints[52] = selectionListCap(packed.pageCount);
}

/** `drawnWordOffset` : rang du compte de la liste compactée dans le relevé, 0 quand il n'y en a pas. */
export function parseDagOutput(
  bytes: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  drawnWordOffset: number,
  scratch: DagOutputScratch = createDagOutputScratch(),
): SelectionResult | null {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  const count = Math.min(ints[0] ?? 0, Math.max(0, (drawnWordOffset || ints.length) - 4));
  // Tableaux dimensionnés d'avance : la lecture d'une image ne fait pas croître un tableau vide
  // élément par élément, et l'itérateur d'un tableau typé n'est jamais déroulé.
  const { result, drawable } = scratch,
    pageIds = result.pageIds;
  pageIds.length = count;
  for (let i = 0; i < count; i++) pageIds[i] = ints[4 + i];
  result.frustumRejected = ints[1] ?? 0;
  result.lodLevel = ints[2] ?? 0;
  result.complete = ((ints[3] ?? 0) & 2) === 0;
  // Bit 1 : la coupe ne tenait pas sous le plafond du relevé. Ce n'est pas une panne de la carte —
  // les noyaux ont tourné, le masque de l'image est juste — mais la LISTE rapportée est amputée, et
  // rien de ce qui en vit ne doit la prendre pour la coupe entière.
  result.truncated = ((ints[3] ?? 0) & 1) !== 0;
  result.drawablePageIds = undefined;
  // La liste dessinable arrive déjà compactée, dans l'ordre croissant : le processeur ne parcourt
  // plus un drapeau par page du DAG, seulement les rangs que la carte graphique a retenus.
  if (drawnWordOffset) {
    const drawnCount = Math.min(
      ints[drawnWordOffset] ?? 0,
      Math.max(0, ints.length - drawnWordOffset - 4),
    );
    drawable.length = drawnCount;
    for (let i = 0; i < drawnCount; i++) drawable[i] = ints[drawnWordOffset + 4 + i];
    result.drawablePageIds = drawable;
  }
  return result;
}
