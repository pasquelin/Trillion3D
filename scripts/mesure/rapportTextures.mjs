const go = (b) => (typeof b === 'number' ? `${(b / 1e9).toFixed(3)} Go` : 'non mesuré');
const n = (v) => (typeof v === 'number' ? String(v) : 'non mesuré');

/**
 * Les textures d'un côté, lues dans les métriques que le moteur publie déjà. Les octets d'atlas sont
 * CALCULÉS depuis dimensions, couches, mips et format — WebGPU ne publie pas la mémoire occupée — et
 * le budget ne descend jamais sous l'alloué : un rapport « engagés / budget » à 100 % ne dit pas que
 * le budget est tenu, il dit que tout est alloué d'avance. « non mesuré » n'est pas zéro.
 */
export function textures(metrics, resultat = {}) {
  const m = metrics ?? {};
  const reseau = resultat.reseau
    ? Object.entries(resultat.reseau)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, bytes]) => `${kind} ${go(bytes)}`)
        .join(', ')
    : 'non mesuré';
  const preparation =
    typeof resultat.preparationMs === 'number'
      ? `${(resultat.preparationMs / 1000).toFixed(2)} s`
      : 'non mesurée';
  const classes = Array.isArray(m.textureAtlasClassBytesCalculated)
    ? ` (${m.textureAtlasClassBytesCalculated.map(go).join(' + ')})`
    : '';
  return [
    `- Textures : atlas ${go(m.textureAtlasBytesCalculated)} calculés sur ` +
      `${n(m.textureAtlasClassesUsed)} classe(s)${classes} ; engagés ${go(m.textureResidentBytes)} ` +
      `sur un budget de ${go(m.textureBudgetBytes)} ; couches au niveau voulu ` +
      `${n(m.textureAtWantedLevel)} / ${n(m.textureLayers)} ; niveaux manquants ` +
      `${n(m.textureMissingLevels)} ; transferts défaits ${n(m.textureEvictions)}`,
    `- Préparation ${preparation} ; réseau depuis la préparation : ${reseau}`,
    '',
  ];
}
