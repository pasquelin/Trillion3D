import type { Page } from 'playwright';
import { VIEWS, poseAt } from './poses.ts';
import { measurePayload } from './seriesPage.ts';
import { measureGazeNetwork, type GazeNetworkReading } from './gazeNetwork.ts';
import type { Bounds } from './poses.ts';
import type { RunContext } from './report/types.ts';
import type { Side } from './sideOptions.ts';

/** One fresh browser per side and trajectory, without warmup, capture or settle barrier. */
export async function runGazeSeries(
  ctx: RunContext,
  sides: Side[],
  views: (keyof typeof VIEWS)[],
  bounds: Bounds,
  onFreshPage: <T>(run: (page: Page) => Promise<T>) => Promise<T>,
) {
  if (ctx.settings.frames < 1) throw new Error('--images must be positive for --gaze-network');
  if (ctx.settings.textureSource !== 'cache')
    throw new Error('--gaze-network requires --textures cache');
  if (sides.some((side) => side.engine.id !== 'webgpu-page-raster'))
    throw new Error('--gaze-network requires the WebGPU page engine on every side');
  const rows: GazeNetworkReading[] = [];
  for (const pixelError of ctx.settings.pixelErrors)
    for (const view of views) {
      const index = VIEWS[view].index;
      const pose = poseAt(bounds, index);
      const poses = Array.from({ length: ctx.settings.frames }, (_, i) =>
        poseAt(bounds, index + i),
      );
      for (const side of sides) {
        const payload = measurePayload(
          side,
          view,
          pixelError,
          pose,
          poses,
          '',
          ctx.settings,
          ctx.lights,
          ctx.MANIFEST,
        );
        rows.push(await onFreshPage((page) => measureGazeNetwork(page, payload, view, side.name)));
      }
    }
  return rows;
}

export function gazeNetworkLines(rows?: GazeNetworkReading[]) {
  if (!rows) return [];
  const lines = [
    '## Gaze-driven network transfer',
    '',
    'Ordinary camera frames only; no image-settling barrier. Chrome encoded transfer bytes include response overhead; cached responses count as zero.',
    '',
    '| view | pixelError | side | frames | texture MB | other MB | texture requests | failed | unfinished |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows)
    lines.push(
      `| ${row.view} | ${row.pixelError} | ${row.side} | ${row.frames} | ` +
        `${(row.textureBytes / 1e6).toFixed(2)} | ${(row.otherBytes / 1e6).toFixed(2)} | ` +
        `${row.textureRequests} | ${row.failedRequests} | ${row.unfinishedRequests} |`,
    );
  return [...lines, ''];
}
