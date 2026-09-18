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
  const reglages = await import(`${options.modulesUrl}pageExplorateur.mjs`);
  const mesure = await import(`${options.modulesUrl}pageMesure.mjs`);
  // La préparation, chronométrée de l'appel au retour, et ce qu'elle a fait passer sur le réseau :
  // les ressources que la page a chargées jusqu'ici ne sont pas comptées, seules celles d'après.
  const preparationStart = performance.now();
  // Le tampon des entrées de ressources déborde à 250 par défaut ; une scène en charge des dizaines
  // de milliers, et un tampon plein cesse d'enregistrer sans rien dire.
  performance.setResourceTimingBufferSize(1_000_000);
  const resourcesBefore = performance.getEntriesByType('resource').length;
  const explorer = await sdk.createExplorer(canvas, {
    onDiagnostic: (event) => {
      // Ce que la barrière a fait pour poser l'image, et ce qui l'en empêche encore : la cause d'un
      // témoin A/A qui bruite se lit ici, pas dans le bruit.
      if (event.phase === 'pose-settle')
        lost.push(`${event.phase} ${JSON.stringify(event.context)}`);
      if (event.phase !== 'gpu-uncaptured-error' && event.phase !== 'gpu-device-lost') return;
      const cause = event.context ?? {};
      lost.push(`${event.phase} : ${cause.error ?? cause.message ?? cause.reason ?? ''}`);
    },
    ...reglages.optionsExplorateur(options, factory, eclairage),
  });
  const preparationMs = performance.now() - preparationStart;
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
    explorer.setLight(moving.id, { position: mesure.positionLampeMobile(moving, frame) });
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
  // Chaque relevé de passes distinct vu pendant cette boucle, reconnu à l'image qu'il décrit : le
  // même relevé reste accroché aux métriques jusqu'au suivant, et le compter deux fois pèserait.
  const gpuPassSamples = [];
  if (options.stageProfile) {
    explorer.resetStageProfile();
    for (let i = 0; i < options.profileFrames; i++) {
      moveLight(i);
      moveNode(i);
      const frame = explorer.render(poseAt(i));
      const sample = frame.gpuPassMs;
      if (sample && sample.frame !== gpuPassSamples.at(-1)?.frame) gpuPassSamples.push(sample);
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
  // La capture est celle d'une pose CALME (`pageMesure.mjs`) : `imagesCalme` dit combien d'images
  // il a fallu pour que le moteur la tienne, `null` s'il ne tient pas d'image.
  const imagesCalme = await mesure.poseCalme(explorer, current);
  // La capture part telle quelle vers Node, qui l'encode en PNG et la compare.
  const response = await mesure.posterCapture(
    options.captureFile,
    explorer.capture(),
    canvas.width,
    canvas.height,
  );
  // L'ensemble sélectionné, lu comme dans les lots précédents : voir `pageCoupe.mjs`.
  const selection = coupe.lireCoupe(explorer, options.engineId);
  // Les mesures du dernier relevé, `null` compris : une mesure tue serait indistinguable d'une
  // mesure absente, qu'un lecteur remplacerait par zéro — ce que le contrat interdit. Un relevé
  // d'octets par étiquette est une table de nombres : il passe aussi.
  const scalaire = (v) => v === null || typeof v === 'number' || typeof v === 'boolean';
  const table = (v) =>
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'number');
  const metrics = Object.fromEntries(
    Object.entries(last ?? {}).filter(([, v]) => scalaire(v) || table(v)),
  );
  // Les octets passés sur le réseau depuis la préparation, par sorte de fichier : ce que le
  // chargement et la série ont vraiment coûté au serveur, images et niveaux de texture compris.
  const network = mesure.reseauDepuis(resourcesBefore);
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
    gpuPassSamples,
    selection,
    metrics,
    preparationMs,
    network,
    imagesCalme,
    // Le relevé du gouverneur de chemin de calcul : un objet, donc écarté par le filtre scalaire
    // ci-dessus. Sans lui, rien ne dirait quel chemin la campagne a réellement joué.
    mathBatch: last?.mathBatch ?? null,
    size,
    lost,
    captureStatus: response.status,
  };
}
