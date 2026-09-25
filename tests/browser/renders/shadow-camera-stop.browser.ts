// A camera stop releases the representation changes held during the move: their pages are
// drawn again in the frame that marks them, with every other page it reads (#489) — none waits.
// Until then they hold a depth of their extent and are read — never skipped to a coarser level
// or the far proxy, which would drop the shadow. This proof walks the bench's street view of the
// generated facade (`facade-7`: pale walls the sun cuts into sharp shadows, cast through the
// windows by walls the camera does not see), stops, captures the first still frame, checks it
// left no page pending, and counts the pixels it shades otherwise than the settled one away
// from every edge of the settled image.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assetsManifest } from '../../../bench/runner/scene.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { openBenchPage } from '../support/benchChrome.ts';

const SCENE = 'facade-7';
const output = measureOutput('shadow-camera-stop');
const WIDTH = 1248,
  HEIGHT = 702;
// The error the camera cut is asked to hold, in screen pixels: a cluster of the stopped cut
// stands at most this far from its place in the settled one.
const PIXEL_ERROR = 1;
await mkdir(output, { recursive: true });
const { root, page, errors, urls, close } = await openBenchPage(WIDTH, HEIGHT);
try {
  const sample = await page.evaluate(
    async ({ sdkUrl, posesUrl, worldUrl, manifestUrl, size, sun, pixelError }) => {
      const [width, height] = size;
      const { openBenchWorld, settleWorld, shadingGap, png } = await import(worldUrl);
      const { poseAt, VIEWS } = await import(posesUrl);
      const scene: MeasuredWorld = await openBenchWorld('stop', sdkUrl, manifestUrl, size, {
        pixelError,
        clearColor: 0x2a303c,
      });
      scene.addLight({ ...sun, castsShadow: true });
      await scene.awaitPages();
      const settle = async (pose: unknown) => !!(await settleWorld(scene, pose));
      const frame = () => new Promise((next) => requestAnimationFrame(next));
      // The street of the bench: from the `sol` view, `STEPS` trajectory frames along it.
      const START = 6,
        STEPS = 24;
      const pose = (step: number) => poseAt(scene.bounds, VIEWS.sol.index + START + step);
      const settledStart = await settle(pose(0));
      // The move: one pose per animation frame, no flush, as an interactive camera would do;
      // the cut readback lands between frames and the cut churns.
      for (let step = 1; step <= STEPS; step++) {
        await frame();
        scene.render(pose(step));
      }
      // The stop: the first still frame releases what the move held and draws it. (The metrics
      // object is the engine's own, rewritten by every frame: read it now.)
      await frame();
      const pendingAtCapture = scene.render(pose(STEPS)).shadowPagesPending ?? 0;
      const stopped = new Uint8Array(scene.capture());
      const settledEnd = await settle(pose(STEPS));
      const settled = new Uint8Array(scene.capture());
      // The same pose without the sun's shadow: what the shadow darkens on this frame.
      scene.setLight(sun.id, { castsShadow: false });
      const open = (await settle(pose(STEPS))) && new Uint8Array(scene.capture());
      scene.dispose();
      return {
        settledStart,
        settledEnd: settledEnd && !!open,
        pendingAtCapture,
        ...shadingGap(stopped, settled, open || settled, width, pixelError),
        images: {
          stopped: await png(stopped, width, height),
          settled: await png(settled, width, height),
        },
      };
    },
    {
      ...urls,
      manifestUrl: assetsManifest(SCENE, true),
      size: [WIDTH, HEIGHT],
      sun: SUN,
      pixelError: PIXEL_ERROR,
    },
  );
  assert.deepEqual(errors, []);
  const { images, ...measured } = sample;
  for (const [name, bytes] of Object.entries(images))
    await writeFile(resolve(output, `${name}.png`), new Uint8Array(bytes as number[]));
  const proof = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scene: SCENE,
    resolution: [WIDTH, HEIGHT],
    dpr: 1,
    pixelError: PIXEL_ERROR,
    temporalAntialiasing: false,
    ...measured,
    cpuFrameMs: null,
    gpuFrameMs: null,
  };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  assert.equal(proof.settledStart, true, 'the start pose settles');
  assert.equal(proof.settledEnd, true, 'the stop pose settles, with and without the shadow');
  assert.equal(proof.pendingAtCapture, 0, 'the stopped frame drew every page it marked');
  // The frame tests shadows: the sun's shadow darkens the inside of areas, not only edges.
  assert.ok(proof.shadowedOffEdge > 0, `${proof.shadowed} shadowed pixels, none off an edge`);
  // Pages drawn at the stop keep their place: the stopped frame shades as the settled one but
  // within `PIXEL_ERROR` of an edge of the settled image, where a cluster of the stopped cut —
  // or of the casters it draws into the pages — may stand that far from its settled place. A
  // shadow that dropped out, or that came from a coarser level, the proxy or the far side of a
  // page, changes the inside of a lit or shaded area, away from every edge.
  assert.equal(
    proof.offEdge,
    0,
    `${proof.offEdge} pixels shaded otherwise than at rest away from any edge (of ${proof.pixels})`,
  );
} finally {
  await close();
}
