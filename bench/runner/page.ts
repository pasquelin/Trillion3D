// What runs INSIDE the page. Playwright serialises this function: it cannot read any variable or
// call any module function; everything reaches it through its single argument. That is the reason,
// and the only one, why explorer creation is duplicated between `readBounds` below and
// `measureView` in `pageEclairage.ts`, which the page imports by URL.
import type * as SdkBrowser from '../../packages/sdk-browser/src/measurement/measurement.ts';
import type { Bounds } from './poses.ts';

/** What `readBounds` needs to open a tiny explorer: the SDK and manifest it points the page at. */
export interface BoundsOptions {
  sdkUrl: string;
  manifestUrl: string;
}

/** Model bounds, read on a tiny explorer: they give the bench poses. */
export async function readBounds(options: BoundsOptions): Promise<Bounds> {
  const sdk = (await import(options.sdkUrl)) as typeof SdkBrowser;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const explorer = await sdk.openMeasuredWorld(canvas, {
    manifestUrl: options.manifestUrl,
    scope: 'full',
    width: 64,
    height: 64,
    pixelRatio: 1,
    replicaCount: 1,
    detail: 'source',
    pixelError: 8,
    lodAdaptive: false,
    maxResidentPages: 64,
    // Not `'none'`: the type only knows `'visible' | 'all'`, and either way a page never
    // requested for this tiny probe is never preloaded.
    preload: 'visible',
    backends: [sdk.exactPagesBackend],
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
  });
  const box = explorer.bounds;
  const bounds = {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
  explorer.dispose();
  canvas.remove();
  return bounds;
}
