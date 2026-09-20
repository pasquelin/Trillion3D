// Settings passed to `createExplorer` by the measurement page. This module is served to the page
// and imported by its URL, like `pageCoupe.mjs`: `measureView` is serialised by Playwright and
// cannot read any module variable.

/**
 * Explorer settings for a series: what the bench asked for, and nothing else. A missing
 * option leaves the engine its own default; none is invented here.
 */
export function explorerOptions(options, factory, lighting) {
  return {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: options.instances ?? 1,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    // The page ceiling and byte reservoirs: absent (`undefined`), the engine keeps its
    // defaults — the page runs in the browser, nothing is serialised here.
    maxResidentPages: options.maxPages ?? undefined,
    geometryPoolBytes: options.geometryPoolBytes ?? undefined,
    texturePoolBytes: options.texturePoolBytes ?? undefined,
    geometryPoolCeilingBytes: options.geometryPoolCeilingBytes ?? undefined,
    preload: 'visible',
    ...(options.autonomous ? { autonomousGeometry: true } : { backends: [factory] }),
    // The witness light group: empty at creation, filled from the store right after.
    ...(lighting ? { sceneLighting: lighting.groupe } : {}),
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    // An engine DIAGNOSTIC variant, when the bench asks for one: it produces a different
    // image by construction, and the SDK refuses it outside the "trace" detail.
    diagnosticDetail: options.trace ? 'trace' : 'summary',
    ...(options.variant ? { diagnosticGpuVariant: options.variant } : {}),
    // The EXPERIENCE screen-error metric: absent, the explorer keeps ours.
    ...(options.errorMetric ? { screenError: options.errorMetric } : {}),
    // The batch compute path imposed on the campaign (`--chemin-math js|wasm`); without it,
    // the governor decides by measurement, and the reading says what it chose.
    ...(options.mathPath ? { mathPath: options.mathPath } : {}),
    // The per-stage breakdown exists only if asked for; it is off everywhere else.
    stageProfile: options.stageProfile === true,
    // Same for bounce lighting: the engine turns it off by default, the bench can turn it on.
    bounce: options.bounce === true,
    // Lights the source file carried: the engine declares them alone, the bench can silence them.
    importedLights: options.importedLights !== false,
    // The Shadows-stage budget and page invalidation: without these options, the engine keeps
    // its own published settings.
    ...(typeof options.shadowBudgetMs === 'number'
      ? { shadowBudgetMs: options.shadowBudgetMs }
      : {}),
    ...(options.shadowPages === false ? { shadowPageInvalidation: false } : {}),
    // Texture levels read from the cache rather than decoded source images.
    ...(options.textureSource === 'cache' ? { textureSource: 'cache' } : {}),
    // Block format of the texture pools; the engine takes `auto` without it.
    ...(options.textureCompression ? { textureCompression: options.textureCompression } : {}),
    // Temporal antialiasing cut: the pre-batch image, sampled at the pixel centre.
    ...(options.temporalAntialiasing === false ? { temporalAntialiasing: false } : {}),
  };
}
