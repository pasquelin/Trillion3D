import { go, mo } from './rapportTextures.mjs';

const num = (v) => (typeof v === 'number' ? v : null);
/** Les étiquettes publiées dans le résumé : au-delà, le relevé complet est dans `mesure.json`. */
const PLUS_LOURDES = 8;

/**
 * La mémoire de la carte graphique par côté et par vue, lue dans le registre d'allocations que le
 * moteur publie : le total est ce qu'il a alloué et pas détruit, calculé depuis chaque descripteur
 * — WebGPU ne publie pas la mémoire occupée. Les trois familles nommées viennent des compteurs du
 * moteur (pool de textures calculé, géométrie allouée, cibles admises par le budget d'image) ; le reste est la
 * différence. Un côté sans registre est « non mesuré », jamais zéro.
 */
export function memoire(report) {
  const lines = [
    '| vue | seuil | côté | total alloué | pool de textures | géométrie | cibles d’image / budget | reste |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const details = [];
  for (const serie of report.series)
    for (const [side, resultat] of Object.entries(serie.sides)) {
      const m = resultat.metrics ?? {};
      const total = num(m.gpuAllocatedBytes);
      const atlas = num(m.texturePoolBytes),
        geometrie = num(m.geometryAllocationBytes),
        cibles = num(m.gpuFrameTargetBytes);
      const reste = total === null ? null : total - (atlas ?? 0) - (geometrie ?? 0) - (cibles ?? 0);
      lines.push(
        `| ${serie.view} | e${serie.pixelError} | ${side} | ${go(total)} | ${go(atlas)} ` +
          `| ${go(geometrie)} | ${mo(cibles)} / ${mo(m.gpuFrameBudgetBytes)} | ${go(reste)} |`,
      );
      details.push(...plusLourdes(serie, side, m));
    }
  return [...lines, '', ...details];
}

/** Les allocations les plus lourdes d'un côté, par étiquette, et l'aveu d'un format inconnu. */
function plusLourdes(serie, side, m) {
  if (typeof m.gpuAllocatedBytes !== 'number') return [];
  const inconnues = num(m.gpuAllocationsUnknownFormat);
  const parEtiquette = Object.entries(m.gpuAllocatedByLabel ?? {})
    .slice(0, PLUS_LOURDES)
    .map(([label, bytes]) => `${label} ${mo(bytes)}`)
    .join(', ');
  return [
    `- ${serie.view} · e${serie.pixelError} · ${side}, les plus lourdes : ${parEtiquette || 'aucune'}` +
      (inconnues
        ? ` — ${inconnues} texture(s) d'un format inconnu du registre, comptées pour zéro : ce total n'est pas une preuve`
        : ''),
  ];
}
