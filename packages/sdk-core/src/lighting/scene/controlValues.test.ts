import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLightingSceneControls,
  createDefaultLightingSceneLights,
  LIGHTING_CAMERA_POSES,
} from './controls.ts';

const panel = () => ({ id: 'panel_1', color: [0, 0.5, 1], intensity: 0, position: [1, 2, 3] });
test('lighting control bounds accept inclusive zero and one but refuse every invalid input', () => {
  for (const [door, light, patch, roughness] of [
    [0, 0, 1, 0],
    [-1, 1, 2, 1],
  ])
    assert.deepEqual(
      validateLightingSceneControls(door, light, patch, roughness, { lights: [] }),
      [],
    );
  for (const args of [
    [NaN, 1, 1, 0.5],
    [Infinity, 1, 1, 0.5],
    [0, NaN, 1, 0.5],
    [0, Infinity, 1, 0.5],
    [0, -1, 1, 0.5],
    [0, Number.MAX_VALUE, 1, 0.5],
    [0, 1, 0, 0.5],
    [0, 1, -1, 0.5],
    [0, 1, NaN, 0.5],
    [0, 1, Infinity, 0.5],
    [0, 1, 1, NaN],
    [0, 1, 1, Infinity],
    [0, 1, 1, -0.1],
    [0, 1, 1, 1.1],
  ])
    assert.throws(
      () => validateLightingSceneControls(args[0], args[1], args[2], args[3], {}),
      RangeError,
    );
  const lights = [panel()];
  assert.equal(validateLightingSceneControls(0, 1, 1, 0.5, { lights } as any), lights);
  assert.equal(validateLightingSceneControls(0, 1, 1, 0.5, {}).length, 3);
  const first = createDefaultLightingSceneLights(),
    second = createDefaultLightingSceneLights();
  first[0].color[0] = 0;
  first[1].position[1] = -10;
  first[2].intensity = 100;
  assert.notDeepEqual(first, second);
});

test('each panel must have a unique valid name, RGB color, finite position and bounded power', () => {
  const patches = [
    { id: 3 },
    { id: '' },
    { id: 'Upper' },
    { id: 'invalid-name' },
    { color: [0, 1] },
    { color: [0, 1, 0, 1] },
    { color: [NaN, 0, 1] },
    { color: [0, -0.1, 1] },
    { color: [0, 1, 1.1] },
    { position: [1, 2] },
    { position: [1, 2, 3, 4] },
    { position: [1, NaN, 3] },
    { position: [1, 2, Infinity] },
    { intensity: -1 },
    { intensity: NaN },
    { intensity: Infinity },
    { intensity: Number.MAX_VALUE },
  ];
  for (const patch of patches)
    assert.throws(
      () =>
        validateLightingSceneControls(0, 1, 1, 0.5, { lights: [{ ...panel(), ...patch }] } as any),
      RangeError,
    );
  assert.throws(
    () => validateLightingSceneControls(0, 1, 1, 0.5, { lights: [panel(), panel()] } as any),
    RangeError,
  );
  const sixteen = Array.from({ length: 16 }, (_, i) => ({ ...panel(), id: `panel_${i}` }));
  assert.equal(validateLightingSceneControls(0, 1, 1, 0.5, { lights: sixteen } as any).length, 16);
  assert.throws(
    () =>
      validateLightingSceneControls(0, 1, 1, 0.5, {
        lights: [...sixteen, { ...panel(), id: 'extra' }],
      } as any),
    RangeError,
  );
});

test('default lighting views aim into the rooms and panels remain inside their room bounds', () => {
  for (const [name, pose] of Object.entries(LIGHTING_CAMERA_POSES)) {
    assert.equal(pose.position.length, 3);
    assert.equal(pose.target.length, 3);
    assert.ok(pose.target[0] < 0 && pose.target[1] > 0 && pose.target[1] < 3);
    assert.ok(pose.position[0] * (name === 'left_room' ? -1 : 1) > 0);
    assert.ok(pose.target[2] <= 0);
  }
  for (const light of createDefaultLightingSceneLights()) {
    assert.ok(light.position[0] * (light.id === 'cyan' ? 1 : -1) > 0);
    assert.ok(light.position[1] > 2.5 && light.position[1] < 3);
    assert.ok(light.position[2] * (light.id === 'magenta' ? -1 : 1) >= 0);
  }
  assert.throws(
    () => validateLightingSceneControls(0, Number.MAX_VALUE, 1, 0.5, { lights: [] }),
    /Invalid lighting experiment parameters/,
  );
  assert.throws(
    () =>
      validateLightingSceneControls(0, 1, 1, 0.5, {
        lights: Array.from({ length: 17 }, (_, i) => ({ ...panel(), id: `panel_${i}` })),
      } as any),
    /at most 16 area panels/,
  );
});
