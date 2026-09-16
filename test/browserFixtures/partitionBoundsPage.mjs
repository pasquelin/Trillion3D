// Les bornes du modèle, lues sur un explorateur minuscule : ce dont la trajectoire du banc a besoin
// pour poser sa caméra. Rien d'autre n'est rendu, et l'explorateur est libéré aussitôt.
export async function readSceneBounds(options) {
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
