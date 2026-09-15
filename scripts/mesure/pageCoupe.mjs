// L'ensemble sélectionné d'une série, lu DANS la page. Servi sous `/mesure/` et importé par son URL
// comme `pageTemoin.mjs` : `measureView` est sérialisée par Playwright et ne peut appeler aucune
// fonction de module, mais un `import()` d'URL lui reste ouvert.

/**
 * La coupe sélectionnée, lue sans aucune API ajoutée pour la mesure. WebGPU publie
 * `selectedPageIds()` ; le chemin WebGL n'a pas d'équivalent, mais hors du mode beauté il attache un
 * maillage par page affichée et y dépose son `clusterId`. Le mode `pages` et non `clusters` :
 * `clusters` teinte chaque page de sa couleur, donc un nuanceur par cluster — 80 153 sur Emerald, de
 * quoi épuiser le pilote —, quand `pages` n'en a que deux et rend les mêmes maillages. Les deux
 * sources ne se comparent pas ; le rapport dit laquelle a servi.
 */
export function lireCoupe(explorer, engineId) {
  const backend = explorer.backends.find((candidate) => candidate.id === engineId);
  if (backend && typeof backend.selectedPageIds === 'function')
    return { source: 'selectedPageIds', ids: [...backend.selectedPageIds()].sort() };
  if (!backend || !backend.scene) return { source: null, ids: [] };
  explorer.setDiagnostic('pages');
  const ids = backend.scene.children
    .map((child) => child.userData && child.userData.clusterId)
    .filter((id) => typeof id === 'string')
    .sort();
  explorer.setDiagnostic('beauty');
  return { source: 'clusterId', ids };
}
