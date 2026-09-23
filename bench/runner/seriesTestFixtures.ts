// Shared fixtures for `series.test.ts`, `seriesHiz.test.ts` and `seriesCompute.test.ts`: split out
// to keep the files under the line budget.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { RunContext } from './report/types.ts';
import type { Side } from './sideOptions.ts';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';

/** A mock Playwright `page`: `evaluate` directly returns the metrics provided to it, without
 *  ever entering a page — `measureView` (`lightingPage.ts`) does not run there. */
export function page(metrics: Record<string, unknown>): Page {
  return {
    evaluate: async () => ({
      cpuFrameMs: [],
      cpuSelectMs: [],
      gpuFrameMs: [],
      stageProfile: null,
      importedLights: null,
      lampesTemoin: null,
      shadowAtlas: null,
      movingNode: null,
      selection: { source: null, ids: [] },
      metrics,
      size: { width: 8, height: 8 },
      lost: [],
      captureStatus: 200,
    }),
  } as unknown as Page;
}

export const pose: CameraPose = {
  position: [0, 0, 0],
  target: [0, 0, 0],
  fov: 55,
  near: 0.1,
  far: 100,
};

/** A run context in a throwaway folder, and the side it measures; `settings` adds to the defaults. */
export async function contexte(settings: Partial<RunContext['settings']> = {}) {
  const OUT = await mkdtemp(join(tmpdir(), 'trillion3d-serie-test-'));
  const ctx: RunContext = {
    MANIFEST: 'manifest.json',
    OUT,
    settings: {
      frames: 4,
      warmup: 1,
      maxPages: 32,
      width: 8,
      height: 8,
      ...settings,
    } as RunContext['settings'],
    lights: null,
    poses: null,
  };
  const side = {
    name: 'a',
    dist: 'dist-test',
    from: 'test',
    engine: {
      backend: 'creerMoteur',
      id: 'moteur-test',
      flags: [],
      page: 'lightingPage.ts',
      source: 'cache',
    },
    variant: null,
    errorMetric: null,
  } as unknown as Side;
  return { ctx, side, OUT };
}
