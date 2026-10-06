// Shadow casters are selected from the light, never from the camera: the camera's own cut must
// therefore not move by a single cluster when the sun casts. This proof places the camera of the
// reference scene with the sun right behind it — the pose where every caster of the ground it looks
// at stands out of view — settles it with the sun's shadow on, then off, and compares the camera cut
// of the two: selected and drawn triangles, and the finest level reached. It also walks the bench
// trajectory with the sun, then checks the camera at rest holds its frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../../../bench/runner/lighting/lamps.ts';
import { PATH_POSES, poseAt, VIEWS } from '../../../bench/runner/trajectory/poses.ts';
import { DEFAULT_SCENE } from '../../../bench/runner/assets/scene.ts';
import { streetBounds } from '../../../bench/runner/street/street.ts';
import type { FrameMetrics } from '../../../packages/sdk-core/src/index.ts';
import { animationFrame, runOnDawn } from '../kit/onDawn.ts';
import { benchManifest, SDK_URL, settle } from '../world/proofWorld.ts';
import { luminance, openBenchWorld } from './shadowScene.ts';

const SIZE: [number, number] = [1280, 720];
/** The measurement SDK the bench's street probe imports by its address, as the proofs load it. */

const cutOf = (m: FrameMetrics | null) =>
  m && {
    selectedTriangles: m.selectedTriangles,
    drawnTriangles: m.drawnTriangles,
    lodLevel: m.lodLevel,
  };

async function sunBehindTheEye() {
  const world = await openBenchWorld(DEFAULT_SCENE, SIZE);
  try {
    // The street the bench's eye-level views walk (`street.ts`), as the bench reads it.
    const bounds = await streetBounds({
      sdkUrl: SDK_URL,
      manifestUrl: benchManifest(DEFAULT_SCENE),
    });
    world.addLight({ ...SUN, castsShadow: true });
    await world.awaitPages();
    // The street pose of the bench, turned to look along the sun: the sun is behind the eye.
    const street = poseAt(bounds, VIEWS.street.index);
    const behind = {
      ...street,
      target: street.position.map((v, i) => v + SUN.direction![i] * 4) as typeof street.position,
    };
    const lit = cutOf(await settle(world, behind));
    const shadowed = new Uint8Array(world.capture());
    world.setLight(SUN.id, { castsShadow: false });
    const unlit = cutOf(await settle(world, behind));
    const open = new Uint8Array(world.capture());
    world.setLight(SUN.id, { castsShadow: true });
    // What the sun's shadow darkens on screen: every caster of it stands behind the eye.
    let darkened = 0;
    for (let i = 0; i < open.length / 4; i++)
      if (luminance(open, i) - luminance(shadowed, i) > 40) darkened++;
    // The bench trajectory with the sun: one pose per animation frame, as a moving camera.
    for (let index = 0; index < PATH_POSES; index += 2) {
      await animationFrame();
      world.render(poseAt(bounds, index));
    }
    // Back at rest: once the pending pages are drawn the frame is held, and a held frame encodes
    // nothing — no light cut, no shadow page.
    const rest = poseAt(bounds, 0);
    const still = (await settle(world, rest)) && world.render(rest).frameHeld;
    return {
      withShadow: lit,
      withoutShadow: unlit,
      darkened,
      pixels: open.length / 4,
      stillHeld: still === true,
    };
  } finally {
    world.dispose();
  }
}

test('the camera cut is the same whether the sun casts or not', { timeout: 300_000 }, async () => {
  const errors: string[] = [];
  const reading = await runOnDawn(sunBehindTheEye, null, errors);
  console.log(JSON.stringify(reading));
  assert.deepEqual(errors, []);
  assert.ok(reading.withShadow && reading.withoutShadow, 'both poses settle');
  assert.deepEqual(
    reading.withShadow,
    reading.withoutShadow,
    'the camera cut is the same cluster for cluster whether the sun casts or not',
  );
  assert.ok(reading.darkened > 0, 'casters behind the eye shade the ground it looks at');
  assert.equal(reading.stillHeld, true, 'the camera at rest holds its frame: nothing is encoded');
});
