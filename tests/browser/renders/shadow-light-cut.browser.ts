// Shadow casters are selected from the light, never from the camera: the camera's own cut must
// therefore not move by a single cluster when the sun casts. This proof places the camera of the
// reference scene with the sun right behind it — the pose where every caster of the ground it
// looks at stands out of view — settles it with the sun's shadow on, then off, and compares the
// camera cut of the two: selected, drawn and missing triangles, and the finest level reached.
// It also walks the bench trajectory with the sun and counts the light cuts each frame runs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/scene.ts';
import { SUN } from '../../../bench/runner/lamps.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import { measureOutput } from '../../../bench/core/paths.ts';
import { openBenchPage } from '../support/benchChrome.ts';

const output = measureOutput('shadow-light-cut');
const WIDTH = 1280,
  HEIGHT = 720;
await mkdir(output, { recursive: true });
const { root, page, errors, urls, close } = await openBenchPage(WIDTH, HEIGHT);
try {
  const sample = await page.evaluate(
    async ({ sdkUrl, posesUrl, worldUrl, manifestUrl, size, sun }) => {
      const [width, height] = size;
      const { openBenchWorld, settleWorld, png } = await import(worldUrl);
      const { poseAt, VIEWS, PATH_POSES } = await import(posesUrl);
      const scene: MeasuredWorld = await openBenchWorld('behind', sdkUrl, manifestUrl, size);
      scene.addLight({ ...sun, castsShadow: true });
      await scene.awaitPages();
      const settle = (pose: unknown) => settleWorld(scene, pose);
      // The street pose of the bench, turned to look along the sun: the sun is behind the eye.
      const street = poseAt(scene.bounds, VIEWS.rue.index);
      const d = sun.direction as number[];
      const behind = {
        ...street,
        target: street.position.map((v: number, i: number) => v + d[i] * 4),
      };
      const cut = (m: Record<string, number | null>) => ({
        selectedTriangles: m.selectedTriangles,
        drawnTriangles: m.drawnTriangles,
        uncoveredTriangles: m.uncoveredTriangles,
        lodLevel: m.lodLevel,
      });
      const lit = await settle(behind);
      const shadowed = new Uint8Array(scene.capture());
      scene.setLight(sun.id, { castsShadow: false });
      const unlit = await settle(behind);
      const open = new Uint8Array(scene.capture());
      scene.setLight(sun.id, { castsShadow: true });
      // What the sun's shadow darkens on screen: every caster of it stands behind the eye.
      const luminance = (p: Uint8Array, i: number) =>
        0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const images = {
        shadowed: await png(shadowed, width, height),
        open: await png(open, width, height),
      };
      let darkened = 0;
      for (let i = 0; i < open.length; i += 4)
        if (luminance(open, i) - luminance(shadowed, i) > 40) darkened++;
      // The bench trajectory with the sun: one pose per animation frame, as a moving camera.
      const frame = () => new Promise((next) => requestAnimationFrame(next));
      const cuts: number[] = [];
      for (let index = 0; index < PATH_POSES; index += 2) {
        await frame();
        cuts.push(scene.render(poseAt(scene.bounds, index)).shadowLightCuts ?? 0);
      }
      // Back at rest: once the pending pages are drawn the frame is held, and a held frame
      // encodes nothing — no light cut, no shadow page.
      const rest = poseAt(scene.bounds, 0);
      const still = (await settle(rest)) && scene.render(rest);
      scene.dispose();
      return {
        withShadow: lit && cut(lit),
        withoutShadow: unlit && cut(unlit),
        darkened,
        pixels: open.length / 4,
        images,
        lightCutsMax: Math.max(...cuts),
        lightCutsMean: cuts.reduce((a, b) => a + b, 0) / cuts.length,
        framesWithLightCuts: cuts.filter((n) => n > 0).length,
        frames: cuts.length,
        stillHeld: !!still && still.frameHeld === true,
      };
    },
    { ...urls, manifestUrl: assetsManifest(DEFAULT_SCENE, true), size: [WIDTH, HEIGHT], sun: SUN },
  );
  assert.deepEqual(errors, []);
  const { images, ...measured } = sample;
  for (const [name, bytes] of Object.entries(images))
    await writeFile(resolve(output, `sun-behind-${name}.png`), new Uint8Array(bytes));
  const proof = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    resolution: [WIDTH, HEIGHT],
    dpr: 1,
    pixelError: 1,
    ...measured,
  };
  await writeFile(resolve(output, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  assert.ok(sample.withShadow && sample.withoutShadow, 'both poses settle');
  assert.deepEqual(
    sample.withShadow,
    sample.withoutShadow,
    'the camera cut is the same cluster for cluster whether the sun casts or not',
  );
  assert.ok(sample.darkened > 0, 'casters behind the eye shade the ground it looks at');
  assert.ok(sample.lightCutsMax > 0, 'the moving camera runs light cuts');
  assert.equal(sample.stillHeld, true, 'the camera at rest holds its frame: no light cut runs');
} finally {
  await close();
}
