// One measured view of the oracle campaign: engine capture, compiler oracle, gap and delay.
// Split from `oracle.ts` to keep it under the file line budget.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';
import { encodePng } from '../../packages/sdk-node/png.mts';
import * as options from './options.ts';
import type { Capture } from '../../tests/kit/server/serveur.ts';
import { measureIrradiance } from './oraclePage.ts';
import type { LightsPlan } from './lampes.ts';
import type { SideBase } from './dists.ts';
import { compareIrradiance, convergenceDelay, oracleJob, runOracle } from './oracleCompare.ts';
import type { OracleReport } from './oracleCompare.ts';
import { sdkEntryUrl } from './dists.ts';

/** The oracle campaign's own settings, read once from flags. */
export interface OracleSettings {
  width: number;
  height: number;
  samples: number;
  bounces: number;
  exposure: number;
  converge: number;
  delayFrames: number;
  delayMargin: number;
  floor: number;
  cadenceHz: number;
  lamps: number;
  intensity: number;
  rangeFactor: number;
  shadows: boolean;
  pixelError: number;
  maxPages: number;
  source: string;
}

/** One measured view: the engine/oracle gap and the reconvergence delay, or a page failure. */
export type VueOracle =
  | { vue?: string; erreur: string }
  | {
      vue: string;
      erreur?: undefined;
      pose: CameraPose;
      lampes: number;
      rebond: Record<string, unknown> | null;
      oracle: OracleReport;
      ecart: ReturnType<typeof compareIrradiance> | { erreur: string };
      retard: ReturnType<typeof convergenceDelay>;
    };

/** Light movement used to measure delay: a clear step, not a slight flicker. */
const MOVED = (
  position: readonly [number, number, number],
  step: number,
): [number, number, number] => [position[0] + step, position[1], position[2] + step];

/** One view's context: everything `runView` needs, nothing it infers. */
export interface RunViewCtx {
  side: SideBase;
  manifestUrl: string;
  settings: OracleSettings;
  pose: CameraPose;
  view: string;
  lights: LightsPlan;
  moving: { id: string; position: [number, number, number] };
  step: number;
  out: string;
  captures: Map<string, Capture>;
  root: string;
}

/** One view: engine converged image, oracle image, gap, and measured delay. */
export async function runView(page: Page, ctx: RunViewCtx): Promise<VueOracle> {
  const { side, manifestUrl, settings, pose, view, lights, moving, step, out, captures, root } =
    ctx;
  const captureFile = `${view}-irradiance.png`;
  const result = await page.evaluate(measureIrradiance, {
    sdkUrl: sdkEntryUrl(side),
    manifestUrl,
    backend: options.ENGINES.webgpu.backend,
    pose,
    captureFile,
    width: settings.width,
    height: settings.height,
    pixelError: settings.pixelError,
    maxPages: settings.maxPages,
    exposure: settings.exposure,
    converge: settings.converge,
    delayFrames: settings.delayFrames,
    lights: lights.lights,
    movingLight: moving.id,
    originalPosition: moving.position,
    movedPosition: MOVED(moving.position, step),
  });
  if ('erreur' in result) return { vue: view, erreur: result.erreur };
  const capture = captures.get(captureFile);
  if (capture)
    await writeFile(join(out, captureFile), encodePng(capture.w, capture.h, capture.body, true));
  const reference = join(out, `${view}.f32`);
  const job = oracleJob(settings, pose, lights.lights, reference);
  const oracle = runOracle(root, job, out, view);
  return {
    vue: view,
    pose,
    lampes: lights.lights.length,
    rebond: result.rebond,
    oracle,
    ecart: capture
      ? compareIrradiance(capture, reference, settings.exposure, settings.floor)
      : { erreur: 'capture absente' },
    retard: convergenceDelay(result.gaps, settings),
  };
}
