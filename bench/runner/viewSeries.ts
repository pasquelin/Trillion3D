// The views of a cache scene: bounds, lights, then one series per threshold, view and side, with
// the A/A witness of the first side. Split from `bench.ts`, which also plays the fluids scene.
import type { Page } from 'playwright';
import * as options from './options.ts';
import { readBounds } from './page.ts';
import { imageDiff } from './summary.ts';
import { benchLights } from './lamps.ts';
import { runSerie } from './series.ts';
import type { Side } from './sideOptions.ts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import type { Report, RunContext, Serie } from './report/types.ts';

/** Runs `run` on a page of a fresh browser, closed after it. */
export type FreshPage = <T>(run: (page: Page) => Promise<T>) => Promise<T>;

/** Plays every view of `views` at every threshold, into `report.series`. */
export async function playViews(
  ctx: RunContext,
  report: Report,
  sides: Side[],
  views: (keyof typeof options.VIEWS)[],
  captures: Map<string, Capture>,
  onFreshPage: FreshPage,
) {
  const manifestUrl = sides[0].manifestUrl ?? ctx.MANIFEST;
  if (!manifestUrl) throw new Error(`no manifest URL for side ${sides[0].name}`);
  report.bounds = await onFreshPage((page) =>
    page.evaluate(readBounds, { sdkUrl: options.sdkEntryUrl(sides[0]), manifestUrl }),
  );
  const bounds = report.bounds;
  // Lights once bounds are known: geometric rule, no named scene.
  ctx.lights = benchLights(bounds, ctx.settings);
  report.lampes = ctx.lights ? ctx.lights.resume : null;
  for (const pixelError of ctx.settings.pixelErrors)
    for (const view of views) {
      const index = options.VIEWS[view].index;
      const pose = options.poseAt(bounds, index);
      // Moving camera: one pose per measured frame along benchmark trajectory.
      ctx.poses = ctx.settings.movingCamera
        ? Array.from({ length: ctx.settings.frames }, (_, i) => options.poseAt(bounds, index + i))
        : null;
      const serie: Serie = {
        view,
        pixelError,
        segment: options.VIEWS[view].segment,
        index,
        pose,
        sides: {},
      };
      report.series.push(serie);
      const files: Record<string, string> = {};
      for (const side of sides) {
        const { row, captureFile } = await onFreshPage((page) =>
          runSerie(ctx, page, side, view, pixelError, pose, captures),
        );
        serie.sides[side.name] = row;
        files[side.name] = captureFile;
      }
      // A/A witness: same side run twice, compared with itself. Shows what zero is.
      const temoin = await onFreshPage((page) =>
        runSerie(ctx, page, sides[0], view, pixelError, pose, captures, '-aa'),
      );
      serie.sides[`${sides[0].name}-aa`] = temoin.row;
      serie.temoinAA = imageDiff(
        captures.get(files[sides[0].name]),
        captures.get(temoin.captureFile),
      );
      serie.ecartAvantApres = files.avant
        ? imageDiff(captures.get(files.avant), captures.get(files.apres))
        : null;
      const avant = serie.sides.avant,
        apres = serie.sides.apres;
      serie.coupeIdentique =
        avant && apres ? avant.selection.sha256 === apres.selection.sha256 : null;
    }
}
