import type { Browser, Page } from 'playwright';
import { declaredError } from './declaredErrors.ts';

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
 * must still reach, the backends it is sparse on and why: every other example, and every example
 * on a backend it is not declared for, keeps the tenth. The shares sit under the ones measured on
 * 2026-09-24, and for the three skinned scenes at half those measured on 2026-10-04: a blank or a
 * refused render never reaches them.
 */
const SPARSE: Record<string, { share: number; on: 'both' | 'webgl2' }> = {
  // A slender spiral stair standing alone in a wide view.
  'a-staircase-from-one-step': { share: 0.04, on: 'both' },
  // Small points on a black sky; the WebGL2 path has no antialiasing, so a point under a pixel
  // that misses the pixel's centre is not drawn. WebGPU's temporal antialiasing keeps the tenth.
  'a-cloud-of-points': { share: 0.04, on: 'webgl2' },
  // One skinned figure walking alone in the middle of a plain sky.
  'a-character-that-walks': { share: 0.006, on: 'both' },
  // Ten small figures walking far off in a plain sky.
  'a-crowd-of-characters': { share: 0.01, on: 'both' },
  // One small skinned tree swaying alone in a plain sky.
  'additive-poses': { share: 0.02, on: 'both' },
};

/** The share of its canvas an example must draw on a backend: a tenth, or its declared share. */
export function leastDrawn(id: string, gpu: boolean): number {
  const sparse = SPARSE[id];
  return sparse && (sparse.on === 'both' || !gpu) ? sparse.share : 0.1;
}

/**
 * A capture of the render alone: the credit line hidden, and every layer drawn over the render —
 * the kit's panels, and a panel or HUD a page builds itself, which carries `data-example-overlay`.
 */
export const RENDER_ONLY = '[data-example-overlay], body > p { display: none }';

/**
 * The share of the page's canvas capture that differs from its top-left pixel: 0 while blank. A
 * pixel differs when its summed channel distance exceeds `tolerance`.
 */
export async function drawnShare(page: Page, canvas = 'canvas#view', tolerance = 0) {
  const png = await page.locator(canvas).screenshot({ style: RENDER_ONLY });
  return page.evaluate(
    async ([dataUrl, tolerance]: [string, number]) => {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        context = canvas.getContext('2d');
      if (!context) throw new Error('2D context unavailable');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let drawn = 0;
      for (let at = 0; at < data.length; at += 4) {
        const distance =
          Math.abs(data[at] - data[0]) +
          Math.abs(data[at + 1] - data[1]) +
          Math.abs(data[at + 2] - data[2]);
        if (distance > tolerance) drawn++;
      }
      return drawn / (data.length / 4);
    },
    [`data:image/png;base64,${png.toString('base64')}`, tolerance] as [string, number],
  );
}

/**
 * Opens one example file in a new page of `browser` and waits until its canvas shows an image,
 * `share` of it drawn at least, `leastDrawn` on that backend unless given (an engine that failed
 * leaves the canvas blank); resolves with the page and the errors it raised or logged, those
 * `declaredError` allows for it (`declaredErrors.ts`: its page and its exact message) aside, which
 * the caller closes and judges.
 *
 * `gpu: false` hides `navigator.gpu` from the page, the machine an example must render on too:
 * naming no backend, it reaches `chooseBackends`, which takes the engine's own WebGL2 path.
 * `slowMs` makes a slowed build of it: every animation-frame callback first spends that long.
 */
export async function openExample(
  browser: Browser,
  port: number,
  entry: GalleryEntry,
  viewport: { width: number; height: number },
  share?: number,
  gpu = true,
  slowMs = 0,
) {
  const least = share ?? leastDrawn(entry.id, gpu);
  const page = await browser.newPage({ viewport });
  const errors: string[] = [],
    requests: string[] = [];
  const heard = (error: string) => declaredError(entry.id, error) || errors.push(error);
  page.on('pageerror', (error) => heard(error.message));
  // The engine says its own failures on the console — a session that cannot open, a frame the
  // WebGL2 program refuses —, and Chrome a resource it could not load, which it names here.
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    heard(text.startsWith('Failed to load resource') ? `${text} ${message.location().url}` : text);
  });
  page.on('request', (request) => requests.push(request.url()));
  if (!gpu)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true });
    });
  if (slowMs)
    await page.addInitScript((spend: number) => {
      const request = requestAnimationFrame.bind(globalThis);
      globalThis.requestAnimationFrame = (callback) =>
        request((time) => {
          for (const end = performance.now() + spend; performance.now() < end;);
          callback(time);
        });
    }, slowMs);
  await page.goto(`http://127.0.0.1:${port}/${entry.file}`);
  let drawn = 0;
  // A page asked to draw nothing (`share` 0), parked until the engine draws it, is only heard.
  if (!least) await page.waitForTimeout(2000);
  for (let attempt = 0; attempt < 30 && drawn < least; attempt++) {
    await page.waitForTimeout(500);
    drawn = await drawnShare(page);
  }
  return { page, errors, drawn, requests };
}
