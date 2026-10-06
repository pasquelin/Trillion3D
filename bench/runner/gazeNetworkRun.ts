import type { Page } from 'playwright';
import { VIEWS, trajectoryPoses } from './poses.ts';
import { measurePayload } from './series/seriesPage.ts';
import { gazeNetworkCounter } from './gazeNetworkCounter.ts';
import type { MeasureViewOptions } from './measureOptions.ts';
import type { Bounds } from './poses.ts';
import type { RunContext } from './report/types.ts';
import type { Side } from './sideOptions.ts';

export type GazeNetworkReading = {
  view: string;
  pixelError: number;
  side: string;
} & ReturnType<ReturnType<typeof gazeNetworkCounter>['reading']>;

/** Chrome's encoded transfer length counts wire bytes; cached responses contribute zero. */
async function measureGazeNetwork(page: Page, payload: MeasureViewOptions) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const counter = gazeNetworkCounter();
  cdp.on('Network.requestWillBeSent', (event) => {
    counter.request(event.requestId, event.request.url, event.redirectResponse?.encodedDataLength);
  });
  cdp.on('Network.requestServedFromCache', (event) => {
    counter.cache(event.requestId);
  });
  cdp.on('Network.responseReceived', (event) => {
    if (event.response.fromDiskCache) counter.cache(event.requestId);
  });
  cdp.on('Network.loadingFinished', (event) => {
    counter.finish(event.requestId, event.encodedDataLength);
  });
  cdp.on('Network.loadingFailed', (event) => {
    counter.fail(event.requestId);
  });
  try {
    await page.evaluate(async (options) => {
      const module = await import(`${options.modulesUrl}gazeNetworkPage.ts`);
      await module.runGazeNetwork(options);
    }, payload);
    // Let requests issued by the last observed frame finish. No new frame or settle barrier runs.
    const deadline = Date.now() + 10_000;
    while ((counter.pending || counter.idleMs < 500) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    return counter.reading();
  } finally {
    await cdp.detach();
  }
}

/** One fresh browser per side and trajectory, without warmup, capture or settle barrier. */
export async function runGazeSeries(
  ctx: RunContext,
  sides: Side[],
  views: (keyof typeof VIEWS)[],
  bounds: Bounds,
  onFreshPage: <T>(run: (page: Page) => Promise<T>) => Promise<T>,
) {
  const rows: GazeNetworkReading[] = [];
  for (const pixelError of ctx.settings.pixelErrors)
    for (const view of views) {
      const poses = trajectoryPoses(bounds, VIEWS[view].index, ctx.settings.frames);
      for (const side of sides) {
        const payload = measurePayload(
          side,
          pixelError,
          poses[0],
          poses,
          '',
          ctx.settings,
          ctx.lights,
          ctx.MANIFEST,
        );
        const reading = await onFreshPage((page) => measureGazeNetwork(page, payload));
        rows.push({ view, pixelError, side: side.name, ...reading });
      }
    }
  return rows;
}

const complete = (row: GazeNetworkReading) =>
  !row.failedRequests && !row.unfinishedRequests && !row.unmeasuredRedirects;

export function gazeNetworkLines(rows?: GazeNetworkReading[], frames?: number) {
  if (!rows) return [];
  const lines = [
    '## Gaze-driven network transfer',
    '',
    `Ordinary camera frames only (${frames} per trajectory); no image-settling barrier. Chrome encoded transfer bytes include response overhead; cached responses count as zero.`,
    '',
    '| view | pixelError | side | texture MB | other MB | texture requests | failed | unfinished | unknown redirects | reading |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows)
    lines.push(
      `| ${row.view} | ${row.pixelError} | ${row.side} | ` +
        `${(row.textureBytes / 1e6).toFixed(2)} | ${(row.otherBytes / 1e6).toFixed(2)} | ` +
        `${row.textureRequests} | ${row.failedRequests} | ${row.unfinishedRequests} | ` +
        `${row.unmeasuredRedirects} | ${complete(row) ? 'complete' : 'incomplete'} |`,
    );
  return [...lines, ''];
}
