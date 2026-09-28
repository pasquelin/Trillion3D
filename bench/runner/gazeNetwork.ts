import type { Page } from 'playwright';
import type { MeasureViewOptions } from './measureOptions.ts';
import { gazeNetworkCounter } from './gazeNetworkCounter.ts';

export interface GazeNetworkReading {
  view: string;
  pixelError: number;
  side: string;
  frames: number;
  textureBytes: number;
  otherBytes: number;
  textureRequests: number;
  failedRequests: number;
  unfinishedRequests: number;
  unmeasuredRedirects: number;
}

/** Chrome's encoded transfer length counts wire bytes; cached responses contribute zero. */
export async function measureGazeNetwork(
  page: Page,
  payload: MeasureViewOptions,
  view: string,
  side: string,
): Promise<GazeNetworkReading> {
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
    return {
      view,
      pixelError: payload.pixelError,
      side,
      frames: payload.frames,
      ...counter.reading(),
    };
  } finally {
    try {
      await page.evaluate(async (modulesUrl) => {
        const module = await import(`${modulesUrl}gazeNetworkPage.ts`);
        await module.closeGazeNetwork();
      }, payload.modulesUrl);
    } finally {
      await cdp.detach();
    }
  }
}
