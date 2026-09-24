import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, serverPort } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { openGalleryScene, sdkMounts } from '../support/renderHarness.ts';
import { measureOutput } from '../../../bench/core/paths.ts';

const root = resolve(import.meta.dirname, '../../..'),
  output = measureOutput('mountain-terrain');
await mkdir(output, { recursive: true });
const server = await startServer({
  port: 0,
  captures: new Map(),
  mounts: [...sdkMounts(root), { prefix: '/site/', dir: resolve(root, 'site') }],
});
const browser = await launchChrome({ headless: true }),
  errors: string[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 620 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${serverPort(server)}`);
  await openGalleryScene(page, {
    id: 'terrain-proof',
    width: 900,
    height: 620,
    manifestUrl: '/site/assets/gallery/offline/terrain/cache/native/full/manifest.json',
    texturePoolBytes: 64 * 1024 * 1024,
    position: [10.5, 8.2, 12.5],
    target: [0, 1.1, 0],
  });
  const sample = await page.evaluate(async () => {
    let metrics;
    for (let frame = 0; frame < 64; frame++) {
      metrics = window.scene.render();
      await window.scene.flush();
      if (window.scene.backends[0].metrics().frameHeld) break;
    }
    const pixels = new Uint8Array(window.scene.capture());
    const colors = new Set();
    const background = pixels.slice(0, 3);
    let visiblePixels = 0,
      riverPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index],
        green = pixels[index + 1],
        blue = pixels[index + 2];
      const distance =
        Math.abs(red - background[0]) +
        Math.abs(green - background[1]) +
        Math.abs(blue - background[2]);
      if (distance > 24) {
        visiblePixels++;
        colors.add(`${red >> 4},${green >> 4},${blue >> 4}`);
        if (blue > red * 1.3 && blue > green * 1.15) riverPixels++;
      }
    }
    return {
      metrics,
      visiblePixels,
      riverPixels,
      colorBuckets: colors.size,
      size: [window.scene.canvas.width, window.scene.canvas.height],
    };
  });
  assert.deepEqual(sample.size, [1800, 1240]);
  assert.ok(sample.visiblePixels > 150_000, 'the landscape occupies a meaningful image area');
  assert.ok(sample.riverPixels > 8, 'the river remains visible through the mountain valley');
  assert.ok(sample.colorBuckets > 24, 'lighting and material strata remain visually distinct');
  assert.ok(sample.metrics, 'no frame ever rendered');
  assert.equal(sample.metrics.selectedTriangles, 18592);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'mountain-watershed.png') });
  await writeFile(
    resolve(output, 'proof.json'),
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        camera: { position: [10.5, 8.2, 12.5], target: [0, 1.1, 0] },
        resolution: sample.size,
        sourceTriangles: 18592,
        visiblePixels: sample.visiblePixels,
        riverPixels: sample.riverPixels,
        colorBuckets: sample.colorBuckets,
        errors,
      },
      null,
      2,
    ),
  );
  await page.evaluate(() => window.scene.dispose());
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
