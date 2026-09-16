/** Une vue, un côté, un seuil : les durées de chaque image, la coupe sélectionnée, la capture. */
export async function measureView(options) {
  const sdk = await import(options.sdkUrl);
  const coupe = await import(`${options.modulesUrl}pageCoupe.mjs`);
  // Le témoin Three ne lit pas le magasin de lampes du contrat : le harnais, qui est un hôte comme
  // un autre, lui pose lui-même en Three les lampes que ce magasin déclare (`pageTemoin.mjs`).
  const eclairage = options.temoin
    ? (await import(`${options.modulesUrl}pageTemoin.mjs`)).creerEclairageTemoin()
    : null;
  const factory = sdk[options.backend];
  if (!factory) return { erreur: `moteur absent du dist : ${options.backend}` };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  // Ce que la carte graphique a signalé — contexte WebGL perdu, erreur non capturée, appareil
  // perdu —, publié sur la page au fur et à mesure : une image qui échoue emporte sa pile d'appels,
  // jamais la cause, et le banc vient la chercher là.
  const lost = (globalThis.incidentsGpu = []);
  canvas.addEventListener('webglcontextlost', () => lost.push('webglcontextlost'), false);
  const explorer = await sdk.createExplorer(canvas, {
    onDiagnostic: (event) => {
      if (event.phase !== 'gpu-uncaptured-error' && event.phase !== 'gpu-device-lost') return;
      const cause = event.context ?? {};
      lost.push(`${event.phase} : ${cause.error ?? cause.message ?? cause.reason ?? ''}`);
    },
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
  // Ce que le fichier a apporté, avant tout ajout du banc. Un dist plus ancien que le lot d'import
  // des lampes n'a pas cette fonction : la mesure rend `null`, jamais un compte inventé.
  const declared = typeof explorer.importedLights === 'function' ? explorer.importedLights() : null;
  const importedLights = declared
    ? { nombre: declared.length, ids: declared.map((light) => light.id) }
    : null;
  // Les lampes du contrat, posées par la règle générique du harnais et passées ici en données : la
  // page ne calcule aucune position et n'invente aucune scène.
  for (const light of options.lights ?? []) explorer.addLight(light);
  // Les mêmes lampes, en Three, pour le témoin : lues du magasin, jamais posées à la main.
  const lampesTemoin = eclairage ? eclairage.suivre(explorer) : null;
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
    eclairage?.suivre(explorer);
  };
  const pose = options.pose;
  // Un objet en mouvement : le nœud nommé par l'hôte parcourt un petit cercle. Le premier appel le
  // pose à l'origine du monde — un grand saut, une seule fois — puis les pas suivants sont petits,
  // le cas même que l'invalidation par pages traite. Un nom absent est consigné, jamais tu.
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
  // La dernière pose rendue, celle que la vidange de la file d'ombres rejoue : la capture qui suit
  // est alors exactement celle des lots précédents. Une pose par image quand la caméra bouge.
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
  // celle des lots précédents, sinon ses durées ne se compareraient plus. On rend ici la main au
  // navigateur entre deux images, parce que les relevés d'horodatage reviennent par une promesse et
  // qu'une boucle qui n'attend jamais n'en récupère presque aucun ; la fenêtre est vidée d'abord.
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
  // La file des pages d'ombre est vidée avant toute lecture de l'atlas : une page en attente porte
  // l'ancienne profondeur, et l'empreinte ne prouverait rien. La boucle est bornée, et le compte
  // restant est publié tel quel, jamais supposé nul.
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
  // L'ensemble sélectionné, lu comme dans les lots précédents : voir `pageCoupe.mjs`.
  const selection = coupe.lireCoupe(explorer, options.engineId);
  // Les mesures scalaires du dernier relevé, `null` compris : une mesure tue serait indistinguable
  // d'une mesure absente, qu'un lecteur remplacerait par zéro — ce que le contrat interdit.
  const scalaire = (v) => v === null || typeof v === 'number' || typeof v === 'boolean';
  const metrics = Object.fromEntries(Object.entries(last ?? {}).filter(([, v]) => scalaire(v)));
  const size = { width: canvas.width, height: canvas.height };
  explorer.dispose();
  canvas.remove();
  return {
    cpuFrameMs,
    cpuSelectMs,
    gpuFrameMs,
    importedLights,
    lampesTemoin,
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
