import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLightingScene,
  createDefaultLightingSceneLights,
  type Scene,
} from './lightingExperimentScene.ts';
import { close } from '../../tests/fixtures/lightingSceneTestHelpers.ts';

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
