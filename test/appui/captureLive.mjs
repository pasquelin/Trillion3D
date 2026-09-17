/**
 * Mode `live` de la preuve navigateur : la pompe de textures n'est jamais forcée.
 *
 * Le mode `flush` vide la file de transfert à chaque point de contrôle, si bien qu'une image capturée
 * y porte toujours la pleine résolution. L'exploration libre, elle, ne force rien : la pompe avance
 * image par image sous le budget. Ce mode rejoue exactement ce régime — aucun `flush()`, aucun
 * `awaitPages()` pendant le parcours — et ne force qu'une seule fois, après la dernière image, pour
 * lire l'image déjà rendue. Ce qui est capturé est donc l'état vivant, pas l'état forcé.
 */
export async function captureLive(inputs) {
  const { explorer, path, framesPerSegment, saveCapture, save, width, height } = inputs;
  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const samples = [];
  // Dernier point de contrôle du parcours : la pose que le mode `flush` capture au segment 9.
  const captureIndex =
    inputs.captureFrame ?? (Math.ceil(path.length / framesPerSegment) - 1) * framesPerSegment;
  let converged = null;
  for (let i = 0; i <= captureIndex; i++) {
    await raf();
    const metrics = explorer.render(path[i].pose);
    samples.push({
      frame: i,
      segment: path[i].segment,
      coverageReady: metrics.coverageReady,
      uncoveredTriangles: metrics.uncoveredTriangles,
      texturePending: metrics.texturePending,
      textureInFlight: metrics.textureInFlight,
      textureUploaded: metrics.textureUploaded,
      textureLevelsUploaded: metrics.textureLevelsUploaded,
      textureSlicesUploaded: metrics.textureSlicesUploaded,
      textureSkipped: metrics.textureSkipped,
      textureBytesLastFrame: metrics.textureBytesLastFrame,
    });
    if (converged === null && metrics.texturePending === 0 && metrics.textureUploaded > 0)
      converged = i;
  }
  const step = path[captureIndex];
  const metrics = { ...explorer.render(step.pose), segment: step.segment };
  // Le seul `flush()` du mode : il lit l'image déjà rendue. La file qu'il vide ensuite ne peut plus
  // changer les pixels capturés — ils sont ceux de l'image d'avant.
  await explorer.flush();
  const pixels = explorer.capture();
  if (pixels.length !== width * height * 4) throw Error('Invalid live capture length');
  let binary = '';
  for (let offset = 0; offset < pixels.length; offset += 8192)
    binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
  const capture = {
    segment: step.segment,
    role: 'candidate',
    mode: 'live',
    pose: step.pose,
    framesBeforeCapture: captureIndex + 1,
    convergedAtFrame: converged,
    texturePending: metrics.texturePending ?? null,
    textureSkipped: metrics.textureSkipped ?? null,
    textureUploaded: metrics.textureUploaded ?? null,
    textureLevelsUploaded: metrics.textureLevelsUploaded ?? null,
    metrics,
  };
  await saveCapture(step.segment, btoa(binary));
  await save(step.segment, JSON.stringify(capture, null, 2));
  return { captures: [capture], samples, convergedAtFrame: converged, captureIndex };
}
