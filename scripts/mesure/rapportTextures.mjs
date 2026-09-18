const go = (b) => (typeof b === 'number' ? `${(b / 1e9).toFixed(3)} Go` : 'non mesuré');
const mo = (b) => (typeof b === 'number' ? `${(b / 1e6).toFixed(1)} Mo` : 'non mesuré');
const n = (v) => (typeof v === 'number' ? String(v) : 'non mesuré');
const n2 = (v) => (typeof v === 'number' ? v.toFixed(2) : 'non mesuré');

/**
 * Les textures virtuelles d'un côté, lues dans les seize compteurs que le moteur publie. Le pool est
 * CALCULÉ depuis ses dimensions et son format — WebGPU ne publie pas la mémoire occupée — et il est
 * fixe : « résident sur pool » dit ce que la vue occupe, jamais ce que la scène pèse. Le retour
 * d'image dit ce que les pixels ont demandé et ce qui leur manque ; « non mesuré » n'est pas zéro.
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
  return [
    `- Textures : pool ${go(m.texturePoolBytes)} calculés, ${n(m.texturePoolLayers)} couche(s) par ` +
      `atlas ; résident ${go(m.textureResidentBytes)} en ${n(m.textureTilesResident)} tuiles`,
    `- Retour d'image : ${n(m.textureTilesRequested)} tuiles demandées, ${n(m.textureTilesAtLevel)} ` +
      `servies au niveau demandé, ${n2(m.textureMissingLevels)} niveau(x) de retard en moyenne, ` +
      `${n(m.textureTilesPending)} en attente`,
    `- Diffuseur : ${n(m.textureTilesServed)} tuiles servies, ${n(m.textureTilesEvicted)} évincées, ` +
      `${n(m.textureTilesRefused)} refusées ; dernière passe ${mo(m.textureBytesLastFrame)} ; ` +
      `niveaux cuits ${n(m.textureLevelReads)} en lecture, ${n(m.textureLevelsDecoded)} décodés, ` +
      `${mo(m.textureLevelCacheBytes)} tenus ; ${n(m.textureScratchBuilds)} textures de travail`,
    `- Préparation ${preparation} ; réseau depuis la préparation : ${reseau}`,
    '',
  ];
}
