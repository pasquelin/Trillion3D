import type { Page } from 'playwright';
import type { MeasureViewOptions } from './measureOptions.ts';

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
  const pending = new Map<string, { url: string; cached: boolean }>();
  let textureBytes = 0;
  let otherBytes = 0;
  let textureRequests = 0;
  let failedRequests = 0;
  let lastActivity = Date.now();
  cdp.on('Network.requestWillBeSent', (event) => {
    lastActivity = Date.now();
    pending.set(event.requestId, { url: event.request.url, cached: false });
  });
  cdp.on('Network.requestServedFromCache', (event) => {
    const request = pending.get(event.requestId);
    if (request) request.cached = true;
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = pending.get(event.requestId);
    if (request)
      request.cached ||= !!event.response.fromDiskCache || !!event.response.fromServiceWorker;
  });
  cdp.on('Network.loadingFinished', (event) => {
    lastActivity = Date.now();
    const request = pending.get(event.requestId);
    if (!request) return;
    const bytes = request.cached ? 0 : event.encodedDataLength;
    if (/\/textures\//.test(new URL(request.url).pathname)) {
      textureBytes += bytes;
      textureRequests++;
    } else otherBytes += bytes;
    pending.delete(event.requestId);
  });
  cdp.on('Network.loadingFailed', (event) => {
    lastActivity = Date.now();
    if (pending.delete(event.requestId)) failedRequests++;
  });
  try {
    await page.evaluate(async (options) => {
      const module = await import(`${options.modulesUrl}gazeNetworkPage.ts`);
      await module.runGazeNetwork(options);
    }, payload);
    // Let requests issued by the last observed frame finish. No new frame or settle barrier runs.
    const deadline = Date.now() + 10_000;
    while ((pending.size || Date.now() - lastActivity < 500) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      view,
      pixelError: payload.pixelError,
      side,
      frames: payload.frames,
      textureBytes,
      otherBytes,
      textureRequests,
      failedRequests,
      unfinishedRequests: pending.size,
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
