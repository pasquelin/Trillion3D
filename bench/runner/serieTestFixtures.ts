// Shared fixtures for `serie.test.ts` and `serieHiZ.test.ts`: split out to keep both files under
// the line budget.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { RunContext } from './report/types.ts';
import type { Side } from './optionsCote.ts';
import type { CameraPose } from '../../packages/sdk-core/index.ts';

/** A mock Playwright `page`: `evaluate` directly returns the metrics provided to it, without
 *  ever entering a page — `measureView` (`pageEclairage.ts`) does not run there. */
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

export async function contexte() {
  const OUT = await mkdtemp(join(tmpdir(), 'wg-serie-test-'));
  const ctx: RunContext = {
    MANIFEST: 'manifest.json',
    OUT,
    settings: {
      frames: 4,
      warmup: 1,
      maxPages: 32,
      width: 8,
      height: 8,
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
      page: 'pageEclairage.ts',
      source: 'cache',
    },
    variant: null,
    errorMetric: null,
  } as unknown as Side;
  return { ctx, side, OUT };
}
