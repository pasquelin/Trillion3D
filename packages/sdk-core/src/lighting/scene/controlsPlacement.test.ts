import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene, type Scene, type Vec3 } from './experimentScene.ts';
import { createDefaultLightingSceneLights, LIGHTING_EYE } from './controls.ts';
import { cross, dot, firstHit } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

/** The floor under a point: which room it is in. */
const roomOf = (scene: Scene, point: Vec3) => firstHit(scene, point, [0, -1, 0]);

test('the eye stands inside the right room, every way it looks meeting a face turned to it', () => {
  const scene = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  for (const axis of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as Vec3[]) {
    const surface = scene.surfaces.find((item) => item.id === firstHit(scene, LIGHTING_EYE, axis));
    assert.ok(surface && dot(cross(surface.u, surface.v), axis) < 0, `${axis}`);
  }
  assert.equal(roomOf(scene, LIGHTING_EYE), 'floor_right_py');
});

test('default panels hang under the ceiling of both rooms, the warm one in the red-walled room', () => {
  const scene = createLightingScene({ doorAngle: 0, lightIntensity: 1 });
  const lights = createDefaultLightingSceneLights();
  for (const light of lights)
    assert.match(firstHit(scene, light.position, [0, 1, 0]) ?? '', /^ceiling_(left|right)_ny$/);
  const rooms = lights.map((light) => roomOf(scene, light.position));
  assert.deepEqual(new Set(rooms), new Set(['floor_left_py', 'floor_right_py']));
  // The red wall's faces, each probed one unit in front: the room of the face that looks into one.
  const redness = (albedo: Vec3) => albedo[0] - albedo[1];
  const reddest = Math.max(...scene.surfaces.map((surface) => redness(surface.albedo)));
  const redRooms = scene.surfaces
    .filter((surface) => redness(surface.albedo) === reddest)
    .map((surface) => {
      const normal = cross(surface.u, surface.v);
      const front = surface.origin.map(
        (value, axis) =>
          value + (surface.u[axis] + surface.v[axis]) / 2 + normal[axis] / Math.hypot(...normal),
      ) as Vec3;
      return roomOf(scene, front);
    })
    .filter((room) => room?.startsWith('floor_'));
  assert.equal(new Set(redRooms).size, 1);
  assert.equal(rooms[lights.findIndex((light) => light.id === 'warm')], redRooms[0]);
});

test('the eye sees a left-room panel through the open door, and only right-room panels when it shuts', () => {
  const visible = (doorAngle: number) => {
    const scene = createLightingScene({ doorAngle, lightIntensity: 1 });
    return scene.surfaces
      .filter((surface) => surface.id.startsWith('ceiling_emitter'))
      .filter((panel) => {
        const centre = panel.origin.map(
          (value, axis) => value + (panel.u[axis] + panel.v[axis]) / 2,
        ) as Vec3;
        const toward = centre.map((value, axis) => value - LIGHTING_EYE[axis]) as Vec3;
        return firstHit(scene, LIGHTING_EYE, toward) === panel.id;
      })
      .map((panel) => {
        const centre = panel.origin.map(
          (value, axis) => value + (panel.u[axis] + panel.v[axis]) / 2,
        ) as Vec3;
        return roomOf(scene, centre);
      });
  };
  assert.ok(visible(Math.PI / 2).includes('floor_left_py'));
  const shut = visible(0);
  assert.ok(shut.length > 0 && shut.every((room) => room === 'floor_right_py'), `${shut}`);
});
