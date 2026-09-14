export async function captureModel({
  createExplorer,
  factory,
  pageBudget,
  stableCaptures,
  events,
  gpu,
  gpuErrors,
  overlaps,
  urbanPath,
  framesPerSegment,
  warmupFrames,
  runAaControl,
}) {
  const modelCanvas = document.createElement('canvas');
  document.body.append(modelCanvas);
  const width = 1246,
    height = 1000,
    captures = [],
    samples = [];
  const explorer = await createExplorer(modelCanvas, {
    manifestUrl: '/benchmark-assets/emerald-square-derived/native/full/manifest.json',
    scope: 'full',
    width,
    height,
    pixelError: 1,
    lodQuality: 'high',
    maxResidentPages: pageBudget,
    preload: 'visible',
    backends: [factory],
    clearColor: 0x2a303c,
    onDiagnostic: (event) => events.push({ stage: 'emerald', ...event }),
  });
  try {
    const path = urbanPath(explorer.bounds),
      checkpoints = path.filter((_, i) => i % framesPerSegment === 0);
    for (const step of checkpoints) {
      explorer.setPose(step.pose);
      await explorer.awaitPages();
    }
    const aa = await runAaControl(explorer, explorer.backend, checkpoints);
    if (aa.length !== 10 || aa.some((check) => check.differentPixels))
      throw Error('A/A failed: ' + JSON.stringify(aa));
    const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let i = 0; i < warmupFrames; i++) {
      await raf();
      explorer.render(path[0].pose);
    }
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (i % framesPerSegment === 0) {
        explorer.setPose(step.pose);
        await explorer.awaitPages();
        await explorer.flush();
      }
      await raf();
      samples.push({ ...explorer.render(step.pose), segment: step.segment });
      if (i % framesPerSegment === 0) {
        if (stableCaptures)
          for (let settle = 0; settle < 4; settle++) {
            explorer.setPose(step.pose);
            await explorer.awaitPages();
            explorer.render(step.pose);
            await explorer.flush();
          }
        await explorer.flush();
        const pixels = explorer.capture();
        if (pixels.length !== width * height * 4) throw Error('Invalid model capture length');
        let foreground = 0;
        for (let p = 0; p < pixels.length; p += 4)
          if (pixels[p] !== 42 || pixels[p + 1] !== 48 || pixels[p + 2] !== 60) foreground++;
        if (foreground < 100) throw Error('Empty model capture at segment ' + step.segment);
        let binary = '';
        for (let offset = 0; offset < pixels.length; offset += 8192)
          binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
        await window.saveCapture(step.segment, btoa(binary));
        captures.push({
          segment: step.segment,
          foreground,
          pose: step.pose,
          metrics: samples.at(-1),
        });
        await window.captureProgress('Emerald capture ' + captures.length + '/10');
      }
    }
    await explorer.flush();
    return {
      gpu,
      gpuErrors,
      events,
      overlaps,
      aa,
      captures,
      samples,
      frames: path.length,
      resolution: [width, height],
      sourceKey: explorer.metadata.key,
      fallbackReason: explorer.fallbackReason,
      userAgent: navigator.userAgent,
    };
  } finally {
    explorer.dispose();
    modelCanvas.remove();
  }
}
