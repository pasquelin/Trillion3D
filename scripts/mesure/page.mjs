// Ce qui s'exécute DANS la page. Playwright sérialise ces fonctions : elles ne peuvent lire aucune
// variable ni appeler aucune fonction de module, tout leur arrive par leur unique argument. C'est
// la raison, et la seule, pour laquelle la création de l'explorateur est écrite deux fois ici.

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

/** Une vue, un côté, un seuil : les durées de chaque image, la coupe sélectionnée, la capture. */
export async function measureView(options) {
  const sdk = await import(options.sdkUrl);
  const factory = sdk[options.backend];
  if (!factory) return { erreur: `moteur absent du dist : ${options.backend}` };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const lost = [];
  canvas.addEventListener('webglcontextlost', () => lost.push('webglcontextlost'), false);
  const explorer = await sdk.createExplorer(canvas, {
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
    backends: [factory],
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
    // Le découpage par étape n'existe que si on le demande ; il est éteint partout ailleurs.
    stageProfile: options.stageProfile === true,
  });
  const pose = options.pose;
  explorer.setPose(pose);
  // Chauffe bornée : la coupe réside avant que quoi que ce soit ne soit relevé.
  for (let i = 0; i < options.warmup; i++) {
    await explorer.awaitPages();
    explorer.render(pose);
    await explorer.flush();
  }
  const cpuFrameMs = [],
    cpuSelectMs = [],
    gpuFrameMs = [];
  let last = null;
  for (let i = 0; i < options.frames; i++) {
    last = explorer.render(pose);
    if (typeof last.cpuFrameMs === 'number') cpuFrameMs.push(last.cpuFrameMs);
    if (typeof last.cpuSelectMs === 'number') cpuSelectMs.push(last.cpuSelectMs);
    if (typeof last.gpuFrameMs === 'number') gpuFrameMs.push(last.gpuFrameMs);
  }
  await explorer.flush();

  // Le profil par étape est relevé par une boucle à part, après la mesure : la boucle mesurée reste
  // strictement celle des lots précédents, sinon ses durées ne se compareraient plus. Ici on rend la
  // main au navigateur entre deux images, parce que les relevés d'horodatage reviennent par une
  // promesse : une boucle qui n'attend jamais n'en récupère presque aucun. La fenêtre est d'abord
  // vidée pour que la chauffe et les premières images ne pèsent plus sur les quantiles.
  let stageProfile = null;
  if (options.stageProfile) {
    explorer.resetStageProfile();
    for (let i = 0; i < options.profileFrames; i++) {
      explorer.render(pose);
      await explorer.flush();
    }
    stageProfile = explorer.stageProfile();
  }

  // La capture part telle quelle vers Node, qui l'encode en PNG et la compare.
  const rgba = explorer.capture();
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  const response = await fetch(
    `/capture?file=${encodeURIComponent(options.captureFile)}&w=${canvas.width}&h=${canvas.height}`,
    { method: 'POST', body },
  );

  // L'ensemble sélectionné, lu sans aucune API ajoutée pour la mesure. Playwright ne sérialise que
  // cette fonction : la lecture est écrite ici, elle ne peut pas vivre dans une fonction voisine.
  // WebGPU publie `selectedPageIds()`. Le chemin WebGL n'a pas d'équivalent : hors du mode beauté
  // le moteur attache un maillage par page affichée et y dépose son `clusterId`. Le mode `pages` et
  // non `clusters` : `clusters` teinte chaque page de sa propre couleur, donc un matériau et un
  // programme de nuanceur par cluster — 80 153 sur Emerald, de quoi épuiser le pilote et faire
  // échouer l'édition de liens. `pages` n'en a que deux et donne exactement les mêmes maillages.
  // Les deux sources ne se comparent pas entre elles ; le rapport dit laquelle a servi.
  const backend = explorer.backends.find((candidate) => candidate.id === options.engineId);
  let selection = { source: null, ids: [] };
  if (backend && typeof backend.selectedPageIds === 'function')
    selection = { source: 'selectedPageIds', ids: [...backend.selectedPageIds()].sort() };
  else if (backend && backend.scene) {
    explorer.setDiagnostic('pages');
    selection = {
      source: 'clusterId',
      ids: backend.scene.children
        .map((child) => child.userData && child.userData.clusterId)
        .filter((id) => typeof id === 'string')
        .sort(),
    };
    explorer.setDiagnostic('beauty');
  }
  const metrics = {};
  for (const key of Object.keys(last || {}))
    if (typeof last[key] === 'number' || typeof last[key] === 'boolean') metrics[key] = last[key];
  const size = { width: canvas.width, height: canvas.height };
  explorer.dispose();
  canvas.remove();
  return {
    cpuFrameMs,
    cpuSelectMs,
    gpuFrameMs,
    stageProfile,
    selection,
    metrics,
    size,
    lost,
    captureStatus: response.status,
  };
}
