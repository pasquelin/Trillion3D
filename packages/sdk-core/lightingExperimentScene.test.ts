import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLightingScene,
  LIGHTING_CAMERA_POSES,
  type Vec3,
} from './lightingExperimentScene.ts';
import {
  sub,
  dot,
  cross,
  unit,
  close,
  firstHit,
} from '../../test/fixtures/lightingSceneTestHelpers.ts';

test('lighting scene retains patch identities under door movement and relighting, within the declared scene budget', () => {
  const closed = createLightingScene({ doorAngle: 0, lightIntensity: 1, patchSize: 1 });
  const open = createLightingScene({ doorAngle: Math.PI / 2, lightIntensity: 0, patchSize: 1 });
  assert.ok(closed.patches.length <= 350);
  assert.equal(closed.patches.length, open.patches.length);
  assert.equal(new Set(closed.surfaces.map((surface) => surface.id)).size, closed.surfaces.length);
  for (let i = 0; i < closed.patches.length; i++) {
    const a = closed.patches[i],
      b = open.patches[i],
      surface = closed.surfaces[a.surface];
    assert.equal(a.id, b.id);
    assert.equal(a.surface, b.surface);
    close(a.area, b.area);
    close(Math.hypot(...a.normal), 1);
    assert.deepEqual(b.emission, [0, 0, 0]);
    if (!surface.moving) assert.deepEqual(a.center, b.center);
    if (surface.kind === 'mirror') assert.deepEqual(a.albedo, [0, 0, 0]);
  }
  for (let i = 0; i < closed.surfaces.length; i++) {
    const surface = closed.surfaces[i];
    assert.match(surface.id, /^[a-z0-9_]+$/);
    close(
      closed.patches
        .filter((patch) => patch.surface === i)
        .reduce((sum, patch) => sum + patch.area, 0),
      Math.hypot(...cross(surface.u, surface.v)),
    );
  }
  const emitter = closed.surfaces.find((surface) => surface.id === 'ceiling_emitter')!;
  emitter.emission.forEach((value, channel) => close(value, [12, 8.4, 5.4][channel]));
  assert.ok(cross(emitter.u, emitter.v)[1] < 0);
});

test('the thick partition blocks rays outside its opening and the closed leaf seals that opening', () => {
  const closed = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  const open = createLightingScene({ doorAngle: Math.PI / 2, lightIntensity: 1 });
  assert.equal(firstHit(closed, [2, 1, 0], [-1, 0, 0]), 'door_px');
  assert.equal(firstHit(open, [2, 1, 0], [-1, 0, 0]), 'west_wall_px');
  assert.equal(firstHit(open, [2, 2.4, 0], [-1, 0, 0]), 'partition_header_px');
  assert.equal(firstHit(open, [2, 1, 1.2], [-1, 0, 0]), 'partition_front_px');
  assert.equal(firstHit(open, [2, 1, -1.2], [-1, 0, 0]), 'partition_back_px');
});

test('both mirrors reflect the right-room camera into the red room when the door opens', () => {
  const open = createLightingScene({ doorAngle: Math.PI / 2, lightIntensity: 1 });
  const closed = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  for (const surface of open.surfaces.filter((surface) => surface.kind === 'mirror')) {
    const center = surface.origin.map(
      (value, i) => value + 0.5 * (surface.u[i] + surface.v[i]),
    ) as Vec3;
    const incoming = unit(sub(center, LIGHTING_CAMERA_POSES.right_room.position));
    assert.equal(firstHit(open, LIGHTING_CAMERA_POSES.right_room.position, incoming), surface.id);
    const normal = unit(cross(surface.u, surface.v));
    const reflected = incoming.map(
      (value, i) => value - 2 * dot(incoming, normal) * normal[i],
    ) as Vec3;
    assert.equal(firstHit(open, center, reflected), 'west_wall_px', surface.id);
    assert.match(firstHit(closed, center, reflected) ?? '', /^door_/, surface.id);
  }
});
