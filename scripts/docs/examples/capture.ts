import { transform } from 'esbuild';
import type { Browser, Page } from 'playwright';

/**
 * The module scripts of an example page, each parsed as the browser would load it: a syntax
 * error — a name declared twice in one scope included — throws here, not in the browser.
 * Imports are not resolved.
 */
export async function exampleModules(html: string): Promise<string[]> {
  const sources = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
    ([, source]) => source,
  );
  for (const source of sources) await transform(source, { loader: 'js', format: 'esm' });
  return sources;
}

/** One example roadmap entry, as read from `site/content/gallery-roadmap.json`. */
export interface GalleryEntry {
  id: string;
  file: string;
}

/**
 * How long an example asks its thumbnail to wait once its render shows, in seconds: the moment
 * it declares most telling (`<meta name="thumbnail" content="3">`), a second and a half when it
 * declares none — a still scene has settled by then.
 */
export function thumbnailDelay(html: string): number {
  const declared = /<meta name="thumbnail" content="([^"]*)"/.exec(html)?.[1];
  if (declared === undefined) return 1.5;
  const seconds = Number(declared);
  if (!(seconds >= 0 && seconds <= 20)) throw new Error(`thumbnail delay ${declared}: 0 to 20 s`);
  return seconds;
}

/**
 * The examples that legitimately draw under the proof's tenth (#527), each with the share it
 * must still reach and why: every other example keeps the tenth. The shares sit under the ones
 * measured on 2026-09-24 (6.2 %, 5.5 %, 8.9 %), which a blank or a refused render never reaches.
 */
export const SPARSE: Record<string, number> = {
  // A slender spiral stair standing alone in a wide view, on either backend.
  'a-staircase-from-one-step': 0.04,
  // Small points on a black sky; without WebGPU no temporal antialiasing widens them.
  'a-cloud-of-points': 0.04,
  // A four-block tower on a grid of one-pixel lines; without WebGPU the lines stay aliased.
  'save-the-scene': 0.06,
};

/** The share of its canvas an example must draw: a tenth, or the share it is declared at. */
export const leastDrawn = (id: string) => SPARSE[id] ?? 0.1;

/** A capture of the render alone: the example kit's panels and the credit line hidden. */
export const RENDER_ONLY = '[data-example-overlay], body > p { display: none }';

/** The share of the page's canvas capture that differs from its top-left pixel: 0 while blank. */
async function drawnShare(page: Page): Promise<number> {
  const png = await page.locator('canvas#view').screenshot({ style: RENDER_ONLY });
  return page.evaluate(
    async (dataUrl: string) => {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = canvas.getContext('2d');
      if (!context) throw new Error('2D context unavailable');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let drawn = 0;
      for (let at = 0; at < data.length; at += 4)
        if (data[at] !== data[0] || data[at + 1] !== data[1] || data[at + 2] !== data[2]) drawn++;
      return drawn / (data.length / 4);
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
}

/** The console lines the engine writes when it stops drawing (`worldHandles.ts`,
 *  `interactive.ts`). */
export const ENGINE_FAILURE =
  /^(?:World session failed|\[trillion3d\] Automatic rendering stopped)/;

/**
 * Opens one example file in a new page of `browser` and waits until its canvas shows an image,
 * `share` of it drawn at least, `leastDrawn` unless given (an engine that failed leaves the
 * canvas blank); resolves with the page and the errors it raised or the engine logged, which the caller closes and judges.
 *
 * `gpu: false` hides `navigator.gpu` from the page, the machine an example must render on too:
 * naming no backend, it reaches `chooseBackends`, which takes the engine's own WebGL2 path.
 */
export async function openExample(
  browser: Browser,
  port: number,
  entry: GalleryEntry,
  viewport: { width: number; height: number },
  share = leastDrawn(entry.id),
  gpu = true,
) {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The engine catches its own failures — a session that cannot open, a frame the WebGL2
  // program refuses — and says them on the console: the page stays blank, and this names why.
  page.on('console', (message) => {
    if (message.type() === 'error' && ENGINE_FAILURE.test(message.text()))
      errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  if (!gpu)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true });
    });
  await page.goto(`http://127.0.0.1:${port}/${entry.file}`);
  let drawn = 0;
  for (let attempt = 0; attempt < 30 && drawn < share; attempt++) {
    await page.waitForTimeout(500);
    drawn = await drawnShare(page);
  }
  return { page, errors, drawn, requests };
}
