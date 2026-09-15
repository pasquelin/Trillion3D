// Ce qui s'exécute DANS la page pour la campagne d'oracle. Playwright sérialise cette fonction :
// elle ne lit aucune variable de module, tout lui arrive par son unique argument.

/**
 * L'irradiance indirecte convergée d'une pose, puis le retard de convergence après qu'une lampe a
 * bougé.
 *
 * La vue `bounce` sort l'irradiance indirecte nue, multipliée par l'exposition et sans ACES ni
 * sRGB : c'est la grandeur que l'oracle du compilateur calcule de son côté. Le retard se mesure en
 * images, jamais en millisecondes de montre : l'écart entre l'image en cours et l'état stable est
 * calculé ici même, et c'est l'appelant qui convertit les images en temps avec la cadence relevée.
 */
export async function measureIrradiance(options) {
  const sdk = await import(options.sdkUrl);
  const factory = sdk[options.backend];
  if (!factory) return { erreur: `moteur absent du dist : ${options.backend}` };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  // Ce que le moteur dit du rebond : sans ce diagnostic, une campagne pourrait mesurer un écart
  // énorme sans voir que le rebond n'était simplement pas gréé.
  const bounce = [];
  const explorer = await sdk.createExplorer(canvas, {
    onDiagnostic: (event) => {
      if (event.phase === 'bounce-lighting') bounce.push(event.context);
    },
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
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
  });
  for (const light of options.lights) explorer.addLight(light);
  explorer.setEnvironment({ exposure: options.exposure });
  explorer.setPose(options.pose);
  const settle = async (frames) => {
    for (let i = 0; i < frames; i++) {
      await explorer.awaitPages();
      explorer.render(options.pose);
      await explorer.flush();
    }
  };
  const moveTo = (position) => explorer.setLight(options.movingLight, { position });
  const shot = () => {
    const rgba = explorer.capture();
    return new Uint8Array(rgba);
  };
  // La différence moyenne par canal entre deux images, rapportée à la moyenne de la référence :
  // un écart relatif, comparable d'une scène à l'autre.
  const gap = (image, reference, mean) => {
    let sum = 0;
    for (let i = 0; i < image.length; i += 4)
      sum +=
        Math.abs(image[i] - reference[i]) +
        Math.abs(image[i + 1] - reference[i + 1]) +
        Math.abs(image[i + 2] - reference[i + 2]);
    return sum / (image.length / 4) / 3 / Math.max(mean, 1e-6);
  };
  const average = (image) => {
    let sum = 0;
    for (let i = 0; i < image.length; i += 4) sum += image[i] + image[i + 1] + image[i + 2];
    return sum / (image.length / 4) / 3;
  };
  explorer.setLightingView('bounce');
  await settle(options.converge);
  const settled = shot();
  const settledMean = average(settled);
  // Le retard : la lampe part sur sa seconde position, la grille reconverge, puis on rejoue le
  // saut en relevant à chaque image l'écart à cet état stable.
  let delay = null;
  const gaps = [];
  if (options.movingLight) {
    moveTo(options.movedPosition);
    await settle(options.converge);
    const moved = shot();
    const movedMean = average(moved);
    moveTo(options.originalPosition);
    await settle(options.converge);
    moveTo(options.movedPosition);
    for (let frame = 0; frame < options.delayFrames; frame++) {
      explorer.render(options.pose);
      await explorer.flush();
      const value = gap(shot(), moved, movedMean);
      gaps.push(value);
      if (delay === null && value <= options.delayThreshold) delay = frame + 1;
    }
    moveTo(options.originalPosition);
    await settle(options.converge);
  }
  // L'image convergée part telle quelle vers Node, qui l'encode et la compare à l'oracle.
  const body = settled.buffer.slice(settled.byteOffset, settled.byteOffset + settled.byteLength);
  const response = await fetch(
    `/capture?file=${encodeURIComponent(options.captureFile)}&w=${canvas.width}&h=${canvas.height}`,
    { method: 'POST', body },
  );
  const size = { width: canvas.width, height: canvas.height };
  explorer.dispose();
  canvas.remove();
  return {
    captureStatus: response.status,
    settledMean,
    delayFrames: delay,
    gaps,
    size,
    rebond: bounce.length ? bounce[bounce.length - 1] : null,
  };
}
