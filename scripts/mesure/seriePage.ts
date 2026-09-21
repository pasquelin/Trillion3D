// The page side of one series: the payload sent into the page, and running it there.
// Split from `serie.ts` to keep it under the file line budget.
import type { Page } from 'playwright';
import type { CameraPose } from '../../packages/sdk-core/index.ts';
import { reservoirs } from './serieReservoirs.ts';
import type { Side } from './optionsCote.ts';
import type { BenchSettings } from './options.ts';
import type { LightsPlan } from './lampes.ts';
import type { MeasureViewOptions, MeasureViewResult } from './mesureOptions.ts';

/** The payload one series sends into the page: everything `measureView` needs. */
export function measurePayload(
  side: Side,
  view: string,
  pixelError: number,
  pose: CameraPose,
  poses: CameraPose[] | null,
  captureFile: string,
  settings: BenchSettings,
  lights: LightsPlan | null,
  manifest: string | null,
): MeasureViewOptions {
  const ENGINE = side.engine;
  const manifestUrl = side.manifestUrl ?? manifest;
  if (!manifestUrl) throw new Error(`no manifest URL for side ${side.name}`);
  return {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl,
    backend: ENGINE.backend,
    engineId: ENGINE.id,
    autonomous: ENGINE.autonomous === true,
    // Modules the page imports by URL, and the witness: an engine that draws through Three does
    // not read the light store, so the host places the same lights in Three.
    modulesUrl: '/mesure/',
    witness: ENGINE.three === true,
    // The engine measurement page, and the source it loads when it is not the cache.
    page: ENGINE.page,
    gltfUrl: side.sourceUrl ?? null,
    pose,
    poses,
    captureFile,
    pixelError,
    frames: settings.frames,
    warmup: settings.warmup,
    // Memory reservoirs requested of the engine, and their in-session tuning; `null` = default.
    ...reservoirs(settings),
    instances: settings.instances,
    width: settings.width,
    height: settings.height,
    stageProfile: settings.stageProfile,
    // This side's diagnostic variant: it is what makes two sides two variants.
    variant: side.variant ?? null,
    // This side's screen-error metric (EXPERIMENT): `null` leaves ours.
    errorMetric: side.errorMetric ?? null,
    trace: settings.trace === true,
    bounce: settings.bounce,
    importedLights: settings.importedLights,
    profileFrames: settings.profileFrames,
    lights: lights ? lights.lights : [],
    moving: lights ? lights.moving : null,
    shadowBudgetMs: settings.shadowBudgetMs,
    shadowPages: settings.shadowPages,
    shadowDigest: settings.shadowDigest,
    // Textures read from the cache: only for an engine that reads the atlas, never the witness.
    textureSource: settings.textureSource,
    textureUploadMs: settings.textureUploadMs,
    temporalAntialiasing: settings.temporalAntialiasing,
    mathPath: settings.mathPath === 'auto' ? null : settings.mathPath,
    movingNode: settings.movingNode,
    movingNodeRadius: settings.movingNodeRadius,
  };
}

/**
 * The measurement run in the page, and what the GPU reported when it fails.
 *
 * A lost frame comes up here with its call stack and nothing else: the cause — validation
 * error, lost device — was only seen in the page. The harness therefore rereads it on the page
 * before rethrowing, so the bench names the cause instead of leaving it to guess.
 */
export async function runInPage(
  page: Page,
  payload: MeasureViewOptions,
): Promise<MeasureViewResult> {
  try {
    return await page.evaluate(async (o) => {
      const module = (await import(`${o.modulesUrl}${o.page}`)) as {
        measureView(options: typeof o): Promise<import('./mesureOptions.ts').MeasureViewResult>;
      };
      const result = await module.measureView(o);
      if ('erreur' in result) return result;
      return { ...result, size: { ...result.size, dpr: devicePixelRatio } };
    }, payload);
  } catch (error) {
    const incidents: string[] = await page
      .evaluate(() => globalThis.incidentsGpu ?? [])
      .catch(() => []);
    const err = error instanceof Error ? error : new Error(String(error));
    if (!incidents.length) throw err;
    throw new Error(`${err.message}\nGPU incidents:\n${incidents.join('\n')}`, {
      cause: error,
    });
  }
}
