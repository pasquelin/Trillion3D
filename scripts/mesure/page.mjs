// Ce qui s'exécute DANS la page. Playwright sérialise ces fonctions : elles ne peuvent lire aucune
// variable ni appeler aucune fonction de module, tout leur arrive par leur unique argument. C'est
// la raison, et la seule, pour laquelle la création de l'explorateur est dupliquée entre
// `readBounds` ci-dessous et `measureView`, sérialisée de la même façon dans `pageEclairage.mjs`.

// measureView reste réexportée d'ici : les consommateurs (`serie.mjs`) l'importent de `page.mjs`.
export { measureView } from './pageEclairage.mjs';

/** Les bornes du modèle, lues sur un explorateur minuscule : elles donnent les poses du banc. */
export async function readBounds(options) {
  const sdk = await import(options.sdkUrl);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const explorer = await sdk.createExplorer(canvas, {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: 64,
    height: 64,
    pixelRatio: 1,
    replicaCount: 1,
    detail: 'source',
    pixelError: 8,
    lodAdaptive: false,
    maxResidentPages: 64,
    preload: 'none',
    backends: [sdk.exactPagesBackend],
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
  });
  const box = explorer.bounds;
  const bounds = {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
  explorer.dispose();
  canvas.remove();
  return bounds;
}
