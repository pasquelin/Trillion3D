import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingScene, type Scene } from './experimentScene.ts';
import {
  createDefaultLightingSceneLights,
  MAX_LIGHTING_PANELS,
  validateLightingSceneControls,
} from './controls.ts';
import { close } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

test('lighting scene rejects nonfinite parameters and an excessive patch allocation', () => {
  for (const options of [
    { doorAngle: NaN, lightIntensity: 1 },
    { doorAngle: 0, lightIntensity: -1 },
    { doorAngle: 0, lightIntensity: 1, patchSize: 0 },
    { doorAngle: 0, lightIntensity: 1, patchSize: 1e-9 },
    { doorAngle: 0, lightIntensity: 1, roughness: 1.1 },
  ])
    assert.throws(() => createLightingScene(options), RangeError);
});

test('independent colored panels move and switch without changing geometry identity or other emitters', () => {
  const lights = createDefaultLightingSceneLights();
  const initial = createLightingScene({ doorAngle: 0, lightIntensity: 1, lights });
  const changed = createDefaultLightingSceneLights();
  changed[0].intensity = 0;
  changed[1].position = [1.5, 2.7, -1];
  changed[1].color = [0.2, 1, 0.1];
  changed.reverse();
  const next = createLightingScene({ doorAngle: 0, lightIntensity: 1, lights: changed });
  assert.deepEqual(
    next.surfaces.map((surface) => surface.id),
    initial.surfaces.map((surface) => surface.id),
  );
  assert.deepEqual(
    next.patches.map((patch) => [patch.id, patch.surface]),
    initial.patches.map((patch) => [patch.id, patch.surface]),
  );
  const sources = initial.surfaces.filter((surface) => surface.id.startsWith('ceiling_emitter'));
  assert.equal(sources.length, 3);
  assert.ok(sources.every((surface) => surface.moving));
  const get = (scene: Scene, id: string) => scene.surfaces.find((surface) => surface.id === id)!;
  assert.deepEqual(get(next, 'ceiling_emitter').emission, [0, 0, 0]);
  assert.deepEqual(get(next, 'ceiling_emitter').origin, get(initial, 'ceiling_emitter').origin);
  assert.notDeepEqual(
    get(next, 'ceiling_emitter_cyan').origin,
    get(initial, 'ceiling_emitter_cyan').origin,
  );
  get(next, 'ceiling_emitter_cyan').emission.forEach((value, channel) =>
    close(value, [0.2, 1, 0.1][channel] * 3.6),
  );
  assert.deepEqual(get(next, 'ceiling_emitter_magenta'), get(initial, 'ceiling_emitter_magenta'));
  const combined = createLightingScene({ doorAngle: 0, lightIntensity: 0.5, lights });
  for (const source of sources)
    get(combined, source.id).emission.forEach((value, channel) =>
      close(value, source.emission[channel] * 0.5),
    );
  assert.deepEqual(
    lights,
    createDefaultLightingSceneLights(),
    'caller controls and defaults are not mutated',
  );
  const originalSingle = createLightingScene({
    doorAngle: 0,
    lightIntensity: 1,
    lights: [{ id: 'warm', color: [1, 11 / 12, 0.75], intensity: 1, position: [-2.5, 2.96, 0] }],
  });
  assert.equal(originalSingle.surfaces.length, 93);
  assert.equal(originalSingle.patches.length, 280);
  assert.deepEqual(get(originalSingle, 'ceiling_emitter').emission, [12, 11, 9]);
  assert.throws(
    () => createLightingScene({ doorAngle: 0, lightIntensity: 1, lights: [lights[0], lights[0]] }),
    /Invalid lighting scene area panel/,
  );
});

const panel = () => ({ id: 'panel_1', color: [0, 0.5, 1], intensity: 0, position: [1, 2, 3] });
const validate = (lights?: unknown[], door = 0, light = 1, patch = 1, roughness = 0.5) =>
  validateLightingSceneControls(door, light, patch, roughness, { lights } as any);

test('scene controls accept zero light, any door angle and the whole roughness range', () => {
  assert.deepEqual(validate([], 0, 0, 1, 0), []);
  assert.deepEqual(validate([], -1, 1, 2, 1), []);
  const lights = [panel()];
  assert.equal(validate(lights), lights);
  assert.deepEqual(validate(), createDefaultLightingSceneLights());
});

test('scene controls refuse a value outside its range or a light whose panels would overflow', () => {
  for (const [door, light, patch, roughness] of [
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
    assert.throws(() => validate([], door, light, patch, roughness), /Invalid lighting experiment/);
});

test('each panel needs a unique lower-case name, an RGB colour in range, a position and a power', () => {
  for (const change of [
    { id: 3 },
    { id: null },
    { id: undefined },
    { id: true },
    { id: { toString: () => 'valid_panel' } },
    { id: '' },
    { id: 'Upper' },
    { id: 'invalid-name' },
    { id: '1panel' },
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
  ])
    assert.throws(() => validate([{ ...panel(), ...change }]), /Invalid lighting scene area panel/);
  assert.throws(() => validate([panel(), panel()]), /Invalid lighting scene area panel/);
  assert.doesNotThrow(() => validate([{ ...panel(), id: 'a', color: [0, 1, 1], intensity: 2 }]));
});

test('a scene holds up to its panel limit and refuses one more', () => {
  const lights = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...panel(), id: `panel_${i}` }));
  assert.equal(validate(lights(MAX_LIGHTING_PANELS)).length, MAX_LIGHTING_PANELS);
  assert.throws(() => validate(lights(MAX_LIGHTING_PANELS + 1)), /at most/);
});

test('default lights are fresh copies each call', () => {
  const first = createDefaultLightingSceneLights();
  first[0].color[0] = first[1].position[1] = first[2].intensity = -1;
  assert.notDeepEqual(first, createDefaultLightingSceneLights());
});
