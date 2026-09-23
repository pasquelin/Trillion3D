// A camera stop releases the representation changes held during the move: their pages go back
// to the queue, and under a tight shadow budget they wait several frames. Those pages still
// hold a depth of their extent and must be read until their redraw lands — never skipped to
// the next cascade or the far proxy, which would drop the shadow. This proof walks the bench's
// street view of the reference scene, stops with a 0.01 ms budget, captures while pages are
// pending, and counts the pixels the settled image shades but the stopped frame lights.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/scene.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { openBenchPage } from '../support/benchPage.ts';

// `window.scene`/`settle`/`stopped`/`pose` only exist in the page this harness evaluates code
// in, never in Node; declared here so the `page.evaluate` callbacks below (type-checked, though
// they run in the browser) see them.
declare global {
  interface Window {
    scene: MeasuredWorld;
    settle: (pose: unknown) => Promise<boolean>;
    stopped: Uint8Array;
    pose: unknown;
  }
}

const output = measureOutput('shadow-camera-stop');
const WIDTH = 1248,
  HEIGHT = 702;
await mkdir(output, { recursive: true });
// The bench scene and its trajectory (`.mesure/assets/`, off git), the engine of this tree.
const { root, page, errors, urls, close } = await openBenchPage(WIDTH, HEIGHT);
try {
  const stop = await page.evaluate(
    async ({ sdkUrl, posesUrl, worldUrl, manifestUrl, size }) => {
      const { openBenchWorld, settleWorld } = await import(worldUrl);
      const { poseAt, VIEWS } = await import(posesUrl);
      const scene: MeasuredWorld = await openBenchWorld('stop', sdkUrl, manifestUrl, size, {
        shadowBudgetMs: 0.01,
        clearColor: 0x2a303c,
      });
      window.scene = scene;
      // The bench sun (`bench/runner/lamps.ts`), with its shadow.
      scene.addLight({
        id: 'sun',
        kind: 'directional',
        direction: [-0.5, -0.64, -0.58],
        color: [1, 0.97, 0.92],
        intensity: 3,
        castsShadow: true,
      });
      await scene.awaitPages();
      // The bench's still pose: rendered and flushed until the frame is held, pages awaited.
      window.settle = async (pose: unknown) => !!(await settleWorld(scene, pose));
      const frame = () => new Promise((next) => requestAnimationFrame(next));
      // The street of the bench: from the `sol` view, `STEPS` trajectory frames along it.
      const START = 6,
        STEPS = 24;
      const pose = (step: number) => poseAt(scene.bounds, VIEWS.sol.index + START + step);
      const settledStart = await window.settle(pose(0));
      // The move: one pose per animation frame, no flush, as an interactive camera would do;
      // the cut readback lands between frames and the cut churns.
      for (let step = 1; step <= STEPS; step++) {
        await frame();
        scene.render(pose(step));
      }
      // The stop: the first still frame releases what the move held; the next drains it under
      // the budget. The capture is taken while pages are still pending.
      let pending = 0,
        metrics;
      for (let i = 0; i < 2; i++) {
        await frame();
        metrics = scene.render(pose(STEPS));
        pending = Math.max(pending, metrics.shadowPagesPending ?? 0);
      }
      window.stopped = new Uint8Array(scene.capture());
      window.pose = pose(STEPS);
      return { settledStart, pending, pendingAtCapture: metrics?.shadowPagesPending ?? 0 };
    },
    { ...urls, manifestUrl: assetsManifest(DEFAULT_SCENE, true), size: [WIDTH, HEIGHT] },
  );
  await page.screenshot({ path: resolve(output, 'stopped.png') });
  const settled = await page.evaluate(async () => {
    const scene = window.scene;
    const settledEnd = await window.settle(window.pose);
    const pixels = new Uint8Array(scene.capture()),
      stopped = window.stopped;
    const luminance = (p: Uint8Array, i: number) =>
      0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    let lighter = 0,
      darker = 0,
      shaded = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      // A pixel whose shading differs from the settled image: a shadow that dropped out, or
      // one that came from the far side of a page or from the proxy instead of its cascade.
      const gap = luminance(stopped, i) - luminance(pixels, i);
      if (gap > 40) lighter++;
      else if (gap < -40) darker++;
      if (luminance(pixels, i) < 60) shaded++;
    }
    return { settledEnd, lighter, darker, shaded, pixels: pixels.length / 4 };
  });
  await page.screenshot({ path: resolve(output, 'settled.png') });
  await page.evaluate(() => window.scene.dispose());
  assert.deepEqual(errors, []);
  const sample = { ...stop, ...settled };
  assert.equal(sample.settledStart, true, 'the start pose settles');
  assert.equal(sample.settledEnd, true, 'the stop pose settles');
  assert.ok(sample.pending > 0, 'the stop left shadow pages pending under the tight budget');
  assert.ok(sample.pendingAtCapture > 0, 'the capture was taken with pages still pending');
  const proof = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    resolution: [WIDTH, HEIGHT],
    dpr: 1,
    temporalAntialiasing: false,
    shadowBudgetMs: 0.01,
    ...sample,
    cpuFrameMs: null,
    gpuFrameMs: null,
  };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  // Pages awaiting a redraw keep their depth: the stopped frame shades as the settled one,
  // but for the texture detail that lands at rest and the silhouettes a change of detail moves.
  // On the public scene 13 of 876 096 pixels differ (#10, #26). Read as "never drawn", those
  // pages sent the whole street to the proxy: 16.6 %, the road black. Casters taken from the
  // camera's cut, which drops them out of view, gave 6.6 %: the settled frame then leaked light.
  const differing = sample.lighter + sample.darker;
  assert.ok(
    differing < sample.pixels / 20,
    `${differing} pixels shaded otherwise than at rest (of ${sample.pixels})`,
  );
} finally {
  await close();
}
