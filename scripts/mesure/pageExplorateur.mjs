// Les réglages passés à `createExplorer` par la page de mesure. Ce module est servi à la page et
// importé par son URL, comme `pageCoupe.mjs` : `measureView` est sérialisée par Playwright et ne
// peut lire aucune variable de module.

/**
 * Les réglages de l'explorateur pour une série : ce que le banc a demandé, et rien d'autre. Une
 * option absente laisse au moteur son propre défaut ; aucune n'est inventée ici.
 */
export function optionsExplorateur(options, factory, eclairage) {
  return {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: options.instances ?? 1,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    ...(options.autonome ? { autonomousGeometry: true } : { backends: [factory] }),
    // Le groupe de lampes du témoin : vide à la création, rempli du magasin juste après.
    ...(eclairage ? { sceneLighting: eclairage.groupe } : {}),
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    // Une variante de DIAGNOSTIC du moteur, quand le banc en demande une : elle rend une image
    // différente par construction, et le SDK la refuse hors du détail « trace ».
    diagnosticDetail: options.trace ? 'trace' : 'summary',
    ...(options.variante ? { diagnosticGpuVariant: options.variante } : {}),
    // La métrique d'erreur écran de l'EXPÉRIENCE : absente, l'explorateur garde la nôtre.
    ...(options.erreur ? { screenError: options.erreur } : {}),
    // Le chemin de calcul en lot imposé à la campagne (`--chemin-math js|wasm`) ; sans lui, le
    // gouverneur arbitre par la mesure, et le relevé dit ce qu'il a choisi.
    ...(options.mathPath ? { mathPath: options.mathPath } : {}),
    // Le découpage par étape n'existe que si on le demande ; il est éteint partout ailleurs.
    stageProfile: options.stageProfile === true,
    // Idem pour la lumière qui rebondit : le moteur l'éteint par défaut, le banc peut l'allumer.
    bounce: options.bounce === true,
    // Les lampes que le fichier source portait : le moteur les déclare seul, le banc peut les taire.
    importedLights: options.importedLights !== false,
    // Le budget de l'étape Ombres et l'invalidation par pages : sans ces options, le moteur garde
    // ses propres réglages publiés.
    ...(typeof options.shadowBudgetMs === 'number'
      ? { shadowBudgetMs: options.shadowBudgetMs }
      : {}),
    ...(options.shadowPages === false ? { shadowPageInvalidation: false } : {}),
    // Les niveaux de texture lus dans le cache plutôt que les images sources décodées.
    ...(options.textureSource === 'cache' ? { textureSource: 'cache' } : {}),
  };
}
