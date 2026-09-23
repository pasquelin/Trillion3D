import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startServer, serverPort } from '../tests/kit/server/staticServer.ts';
import { buildSite, SITE_OUTPUT } from './docs/site.ts';

interface FossilProof {
  triangles: number;
  selected: number;
  held: boolean;
  size: number[];
  occupied: number;
  blue: number;
  red: number;
  differences: number;
}

declare global {
  interface Window {
    disposeFossil: () => void;
  }
}

const root = resolve(import.meta.dirname, '..');
test('the original OBJ excavation renders stable exterior surfaces and coloured field markers', async () => {
  await buildSite();
  const server = await startServer({
    port: 0,
    mounts: [
      { prefix: '/site/', dir: SITE_OUTPUT },
      { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
      { prefix: '/vendor/meshoptimizer/', dir: resolve(root, 'node_modules/meshoptimizer') },
    ],
    captures: new Map(),
  });
  const chrome = await launchChrome({ headless: true });
  try {
    const page = await chrome.newPage({
      viewport: { width: 900, height: 620 },
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    const proof = await page.evaluate<FossilProof, string>(async (moduleUrl) => {
      const { openMeasuredWorld, webgpuPagesBackend } = await import(moduleUrl);
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:900px;height:620px';
      document.body.replaceChildren(canvas);
      const model = await openMeasuredWorld(canvas, {
        manifestUrl: '/site/assets/gallery/fossil-excavation/cache/native/full/manifest.json',
        backends: [webgpuPagesBackend],
        scope: 'full',
        interactive: false,
        width: 900,
        height: 620,
        pixelRatio: 2,
        pixelError: 0,
        temporalAntialiasing: false,
        clearColor: 0x0e1621,
        geometryPoolBytes: 16 * 1024 * 1024,
      });
      model.addLight({
        id: 'sun',
        kind: 'directional',
        direction: [-0.4, -0.8, -0.3],
        color: [1, 0.95, 0.85],
        intensity: 2.5,
        castsShadow: true,
      });
      model.addLight({
        id: 'sky',
        kind: 'directional',
        direction: [0.3, -0.6, 0.7],
        color: [0.75, 0.85, 1],
        intensity: 0.8,
        castsShadow: false,
      });
      model.setPose({ ...model.homePose(), position: [9, 11, 12], target: [0.5, -0.3, 0] });
      let metrics;
      for (let frame = 0; frame < 96; frame++) {
        await model.awaitPages();
        metrics = model.render();
        await model.flush();
        if (metrics.frameHeld) break;
      }
      const pixels = new Uint8Array(model.capture());
      model.render();
      await model.flush();
      const next = new Uint8Array(model.capture());
      let occupied = 0,
        blue = 0,
        red = 0,
        differences = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const [r, g, b] = pixels.subarray(offset, offset + 3);
        if (r !== pixels[0] || g !== pixels[1] || b !== pixels[2]) occupied++;
        if (b > r * 1.4 && b > g * 1.1 && b > 50) blue++;
        if (r > g * 1.4 && r > b * 1.4 && r > 50) red++;
        if (r !== next[offset] || g !== next[offset + 1] || b !== next[offset + 2]) differences++;
      }
      const result = {
        triangles: metrics.drawnTriangles,
        selected: metrics.selectedTriangles,
        held: metrics.frameHeld,
        size: [canvas.width, canvas.height],
        occupied: occupied / (pixels.length / 4),
        blue,
        red,
        differences,
      };
      window.disposeFossil = () => model.dispose();
      return result;
    }, '/site/runtime/engine.js');
    assert.equal(proof.triangles, 9784);
    assert.equal(proof.selected, proof.triangles);
    assert.equal(proof.held, true);
    assert.equal(proof.differences, 0);
    assert.deepEqual(proof.size, [1800, 1240]);
    assert.ok(proof.occupied > 0.1 && proof.occupied < 0.9, JSON.stringify(proof));
    assert.ok(proof.blue > 30 && proof.red > 30, JSON.stringify(proof));
    assert.deepEqual(errors, []);
    const output = resolve(root, 'benchmark-runs/fossil-excavation');
    await mkdir(output, { recursive: true });
    await page.locator('canvas').screenshot({ path: resolve(output, 'excavation.png') });
    await writeFile(
      resolve(output, 'proof.json'),
      JSON.stringify({ ...proof, errors, cpuFrameMs: null, gpuFrameMs: null, fps: null }, null, 2),
    );
    await page.evaluate(() => window.disposeFossil());
  } finally {
    await chrome.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
