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
  });
  // Ce que le fichier a apporté, relevé avant tout ajout du banc. Un dist plus ancien que le lot
  // d'import des lampes n'a pas cette fonction : la mesure rend `null`, jamais un compte inventé.
  const declared = typeof explorer.importedLights === 'function' ? explorer.importedLights() : null;
  const importedLights = declared
    ? { nombre: declared.length, ids: declared.map((light) => light.id) }
    : null;
  // Les lampes du contrat, posées par la règle générique du harnais et passées ici en données : la
  // page ne calcule aucune position, elle n'invente aucune scène.
  for (const light of options.lights ?? []) explorer.addLight(light);
  const moving = options.moving;
  // Une lampe en mouvement : un petit cercle, appliqué avant chaque image mesurée.
  const moveLight = (frame) => {
    if (!moving) return;
    const angle = (frame / moving.period) * Math.PI * 2;
    explorer.setLight(moving.id, {
      position: [
        moving.origin[0] + Math.cos(angle) * moving.radius,
        moving.origin[1],
        moving.origin[2] + Math.sin(angle) * moving.radius,
      ],
    });
  };
  const pose = options.pose;
  // Une pose par image quand la caméra bouge, la même à chaque image sinon.
  // Un objet en mouvement : le nœud que l'hôte a nommé prend une matrice monde dont la translation
  // parcourt un petit cercle. Le premier appel le pose à l'origine du monde — un grand saut, une
  // seule fois — puis les pas suivants sont petits, ce qui est exactement le cas que
  // l'invalidation par pages doit traiter. Un nom absent de la scène est consigné, jamais ignoré.
  const node = options.movingNode;
  let movingNode = null;
  const moveNode = (frame) => {
    if (!node || movingNode?.erreur) return;
    const angle = (frame / 30) * Math.PI * 2,
      r = options.movingNodeRadius ?? 1;
    const matrix = new Float32Array(16);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    matrix[12] = Math.cos(angle) * r;
    matrix[14] = Math.sin(angle) * r;
    try {
      explorer.setTransform(node, matrix);
      movingNode = { noeud: node, rayon: r, images: (movingNode?.images ?? 0) + 1 };
    } catch (error) {
      movingNode = { noeud: node, erreur: String(error) };
    }
  };
  const poses = options.poses;
  // La dernière pose rendue : c'est elle que la vidange de la file d'ombres rejoue, pour que la
  // capture qui suit soit exactement celle des lots précédents.
  let current = pose;
  const poseAt = (frame) => {
    current = poses ? poses[frame % poses.length] : pose;
    return current;
  };
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
    moveLight(i);
    moveNode(i);
    last = explorer.render(poseAt(i));
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
      moveLight(i);
      moveNode(i);
      explorer.render(poseAt(i));
      await explorer.flush();
      // Une vraie limite d'image : le navigateur ne rend un compteur d'horodatage WebGL2 lisible
      // qu'après une frontière d'image, et c'est aussi ce que fait une application réelle.
      await new Promise((done) => requestAnimationFrame(done));
    }
    stageProfile = explorer.stageProfile();
  }

  // La file des pages d'ombre est vidée avant toute lecture de l'atlas : une page encore en attente
  // porte évidemment l'ancienne profondeur, et l'empreinte ne prouverait rien. La boucle est bornée
  // et le compte restant est publié tel quel, jamais supposé nul.
  let shadowAtlas = null;
  if (options.shadowDigest && typeof explorer.shadowAtlasDigest === 'function') {
    let pending = null,
      drains = 0;
    for (; drains < 600; drains++) {
      const frame = explorer.render(current);
      await explorer.flush();
      pending = typeof frame.shadowPagesPending === 'number' ? frame.shadowPagesPending : null;
      if (pending === null || pending === 0) break;
    }
    const digest = await explorer.shadowAtlasDigest();
    shadowAtlas = digest ? { ...digest, pagesEnAttente: pending, images: drains } : null;
  }

  // La capture part telle quelle vers Node, qui l'encode en PNG et la compare.
  const rgba = explorer.capture();
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  const response = await fetch(
    `/capture?file=${encodeURIComponent(options.captureFile)}&w=${canvas.width}&h=${canvas.height}`,
    { method: 'POST', body },
  );

  // L'ensemble sélectionné, lu sans aucune API ajoutée pour la mesure. WebGPU publie
  // `selectedPageIds()`. Le chemin WebGL n'a pas d'équivalent : hors du mode beauté le moteur
  // attache un maillage par page affichée et y dépose son `clusterId`. Le mode `pages` et non
  // `clusters` : `clusters` teinte chaque page de sa propre couleur, donc un matériau et un
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
    importedLights,
    shadowAtlas,
    movingNode,
    stageProfile,
    selection,
    metrics,
    size,
    lost,
    captureStatus: response.status,
  };
}
