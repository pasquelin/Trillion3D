// Ce qui s'exécute DANS la page. Playwright sérialise ces fonctions : elles ne peuvent lire aucune
// variable ni appeler aucune fonction de module, tout leur arrive par leur unique argument. C'est
// la raison, et la seule, pour laquelle la création de l'explorateur est écrite deux fois ici.

/** Les bornes du modèle, lues sur un explorateur minuscule : elles donnent les poses du banc. */
export async function readBounds(options) {
  const { createExplorer, exactPagesBackend } = await import(options.sdkUrl);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const explorer = await createExplorer(canvas, {
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
    backends: [exactPagesBackend],
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

/** Une vue, un côté : les `cpuSelectMs` de chaque image, la coupe sélectionnée, la capture. */
export async function measureView(options) {
  const { createExplorer, exactPagesBackend } = await import(options.sdkUrl);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const explorer = await createExplorer(canvas, {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: 1,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    backends: [exactPagesBackend],
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
  });
  const pose = options.pose;
  explorer.setPose(pose);
  // Chauffe bornée : la coupe réside avant que quoi que ce soit ne soit chronométré.
  for (let i = 0; i < options.warmup; i++) {
    await explorer.awaitPages();
    explorer.render(pose);
    await explorer.flush();
  }
  const samples = [];
  let last = null;
  for (let i = 0; i < options.frames; i++) {
    last = explorer.render(pose);
    if (typeof last.cpuSelectMs === 'number') samples.push(last.cpuSelectMs);
  }
  await explorer.flush();

  // La capture part telle quelle vers Node, qui l'encode en PNG.
  const rgba = explorer.capture();
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  const response = await fetch(
    `/capture?file=${encodeURIComponent(options.captureFile)}&w=${canvas.width}&h=${canvas.height}`,
    { method: 'POST', body },
  );

  // L'ensemble sélectionné : hors du mode beauté le moteur attache un maillage par page affichée
  // et y dépose son `clusterId`. C'est la coupe de l'image, lue sans API ajoutée pour la mesure.
  // Le mode `pages` et non `clusters` : `clusters` teinte chaque page de sa propre couleur, donc
  // un matériau et un programme de nuanceur par cluster — 80 153 sur Emerald, de quoi épuiser le
  // pilote. `pages` n'en a que deux et donne exactement les mêmes maillages. Aucune image n'est
  // dessinée ici : `setDiagnostic` rattache déjà la coupe à la scène.
  explorer.setDiagnostic('pages');
  const backend = explorer.backends.find((candidate) => candidate.id === 'exact-cluster-pages');
  const ids = backend.scene.children
    .map((child) => child.userData && child.userData.clusterId)
    .filter((id) => typeof id === 'string')
    .sort();
  explorer.setDiagnostic('beauty');

  const metrics = {};
  for (const key of Object.keys(last || {}))
    if (typeof last[key] === 'number' || typeof last[key] === 'boolean') metrics[key] = last[key];
  const size = { width: canvas.width, height: canvas.height };
  explorer.dispose();
  canvas.remove();
  return { samples, ids, metrics, size, captureStatus: response.status };
}
