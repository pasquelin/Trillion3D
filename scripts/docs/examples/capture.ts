import type { Browser, Page } from 'playwright';

/** One example roadmap entry, as read from `site/content/gallery-roadmap.json`. */
export interface GalleryEntry {
  id: string;
  file: string;
}

/** The share of the page's canvas capture that differs from its top-left pixel: 0 while blank. */
async function drawnShare(page: Page): Promise<number> {
  const png = await page.locator('canvas').screenshot();
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

/**
 * Opens one example file in a new page of `browser` and waits until its canvas shows an image,
 * `share` of it drawn at least (an engine that failed leaves the canvas blank); resolves with
 * the page and the errors it raised, which the caller closes and judges.
 */
export async function openExample(
  browser: Browser,
  port: number,
  entry: GalleryEntry,
  viewport: { width: number; height: number },
  share = 0.1,
) {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/${entry.file}`);
  let drawn = 0;
  for (let attempt = 0; attempt < 30 && drawn < share; attempt++) {
    await page.waitForTimeout(500);
    drawn = await drawnShare(page);
  }
  return { page, errors, drawn };
}
