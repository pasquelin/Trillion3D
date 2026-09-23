// Settings passed to `openMeasuredWorld` by the measurement page. This module is served to the page
// and imported by its URL, like `cutPage.ts`: `measureView` is serialised by Playwright and
// cannot read any module variable.
import type * as THREE from 'three';
import type {
  BackendFactory,
  MeasuredWorld,
  MeasuredWorldOptions,
} from '../../packages/sdk-browser/src/measurement/measurement.ts';
import type { MeasureViewOptions } from './measureOptions.ts';

/** The witness light group a Three engine renders through, and its store-tracking function. */
export interface WitnessLighting {
  groupe: THREE.Group;
  suivre: (explorer: MeasuredWorld) => unknown;
}

/**
 * MeasuredWorld settings for a series: what the bench asked for, and nothing else. A missing
 * option leaves the engine its own default; none is invented here.
 */
export function explorerOptions(
  options: MeasureViewOptions,
  factory: BackendFactory,
  lighting: WitnessLighting | null,
): MeasuredWorldOptions {
  return {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    // Validated to one of these four values by `options.ts` before it ever reaches the page.
    replicaCount: (options.instances ?? 1) as 1 | 4 | 9 | 12,
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
    // Validated against the known variant list, and against `trace` detail, by the SDK itself
    // (`resolveDiagnosticGpuVariant`) at `openMeasuredWorld`: an unknown name throws there.
    ...(options.variant
      ? { diagnosticGpuVariant: options.variant as MeasuredWorldOptions['diagnosticGpuVariant'] }
      : {}),
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
    // Whether the loader opens the source images. Forwarded both ways since the engine's own
    // default became `'cache'` (#289): a witness side asks for `'host'` and has to be heard, or
    // it would draw the placeholder pixel the loader leaves in a baked image's place.
    textureSource: options.textureSource,
    // The tile pass's millisecond budget: without the option, the engine keeps its own default.
    ...(typeof options.textureUploadMs === 'number'
      ? { maxTextureUploadMsPerFrame: options.textureUploadMs }
      : {}),
    // Block format of the texture pools; the engine takes `auto` without it.
    ...(options.textureCompression ? { textureCompression: options.textureCompression } : {}),
    // Temporal antialiasing cut: the pre-batch image, sampled at the pixel centre.
    ...(options.temporalAntialiasing === false ? { temporalAntialiasing: false } : {}),
  };
}
