// Defect 5: a parented camera must give the same pose to ALL engine sites.
//
// Each site of `parentedSites.fixture.ts` — selection uniforms, cut, Hi-Z, rasters, diagnostics,
// and the whole engines on the fake GPU device — is called frame after frame with a camera child
// of a host group that belongs to no prepared scene, then with the parentless camera of the same
// world pose bit for bit. The two readings must be equal.
//
// Both host contracts are exercised: the one that walks its rig before the frame and the one
// that does not. The engine must be correct in both cases, because an off-scene rig is walked
// by no one but it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSES_PARENT,
  flattenedCamera,
  creeRig,
  poseRig,
} from '../../../../tests/gpu/kit/cameraRig.ts';
import { SITES, renderFrameResidual } from './parentedSites.fixture.ts';
import type { Site } from './parentedEngineSites.fixture.ts';
import type { HostCamera } from './world.ts';

type Pose = (typeof POSES_PARENT)[number];

/** A site's state, when it carries a disposable backend or its own `dispose`. */
type Disposable = { backend?: { dispose?: () => void }; dispose?: () => void } | undefined;

/** A site played over the frame sequence, as texts comparable character for character. */
async function readings(site: Site, camera: (pose: Pose) => HostCamera) {
  const state = (await site.create?.()) as Disposable;
  const frames: string[] = [];
  for (const pose of POSES_PARENT)
    frames.push(JSON.stringify(await site.measure(state, camera(pose))));
  state?.backend?.dispose?.();
  state?.dispose?.();
  return frames;
}

for (const host of [false, true]) {
  const contract = host ? 'walked by the host' : 'left as-is by the host';
  for (const site of SITES)
    test(`${site.name}: parented camera, rig ${contract}`, async () => {
      const rig = creeRig();
      const parented = await readings(site, (pose) => poseRig(rig, pose, host));
      // One flattened camera for the whole sequence, as the rig is one: a fresh camera object with
      // another view is a temporal cut (`trackViewCamera`), which the rig's moves are not.
      const flat = flattenedCamera(POSES_PARENT[0]);
      const flattened = await readings(site, (pose) => flattenedCamera(pose, 55, 16 / 9, flat));
      for (let i = 0; i < POSES_PARENT.length; i++)
        assert.equal(
          parented[i],
          flattened[i],
          `frame ${i}: the rig does not give the flattened pose`,
        );
    });

  test(`selection uniforms: relative view and render origin agree, rig ${contract}`, () => {
    const rig = creeRig();
    for (const pose of POSES_PARENT)
      assert.ok(
        // The threshold is that of the single-precision rounding of a probe a few tens of
        // metres away; a wrong pose, for its part, is counted in metres.
        renderFrameResidual(poseRig(rig, pose, host)) <= 1e-4,
        'the relative view and the render-frame origin describe two different cameras',
      );
  });
}
