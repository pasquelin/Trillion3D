import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_SETTINGS, type SceneLight } from './contracts.ts';
import { validateSceneLight } from './validate.ts';
import { createSceneLightStore } from './store.ts';
import { shadowProjection } from '../light-shadow/math.ts';
import { writeFace } from '../light-shadow/faces.ts';

const lanterne = (emitterRadius?: number): SceneLight => ({
  id: 'lanterne',
  kind: 'point',
  position: [0, 4.84, 0],
  range: 30,
  color: [1, 0.9, 0.7],
  intensity: 12,
  castsShadow: true,
  ...(emitterRadius === undefined ? {} : { emitterRadius }),
});

const view = {
  position: [0, 2, 10] as const,
  forward: [0, 0, -1] as const,
  halfFovY: 0.5,
  aspect: 1,
  near: 0.1,
  far: 100,
};

test('the emitter radius passes validation, and is accepted only in (0, range)', () => {
  assert.equal(validateSceneLight(lanterne(0.2)).emitterRadius, 0.2);
  assert.equal(validateSceneLight(lanterne()).emitterRadius, undefined);
  for (const refuse of [0, -1, 30, 45, Number.NaN])
    assert.throws(() => validateSceneLight(lanterne(refuse)), /emitter radius/);
});

test('a directional light has no envelope, and the contract refuses to lend it one', () => {
  assert.throws(
    () =>
      validateSceneLight({
        id: 'soleil',
        kind: 'directional',
        direction: [0, -1, 0],
        color: [1, 1, 1],
        intensity: 3,
        castsShadow: true,
        emitterRadius: 0.2,
      }),
    /emitterRadius/,
  );
});

test("a shadow map's near plane comes only from the light's range", () => {
  // The 30 m range setting gives the near plane recorded by the checker: 0.15 m.
  const sans = shadowProjection(Math.PI / 2, 30).near;
  assert.equal(
    sans,
    Math.max(LIGHT_SETTINGS.shadowNearMin, 30 * LIGHT_SETTINGS.shadowNearFraction),
  );
  assert.equal(sans, 0.15);
});

test('the shadow face keeps this near plane, whether the light declares an envelope or not', () => {
  const matrices = new Float32Array(16);
  const nu = writeFace(matrices, 0, null, 0, validateSceneLight(lanterne()), 0, view, 1024).near;
  const enveloppe = writeFace(
    matrices,
    0,
    null,
    0,
    validateSceneLight(lanterne(0.25)),
    0,
    view,
    1024,
  ).near;
  assert.equal(nu, 0.15);
  // The envelope is no longer removed by a recorded near plane — which would remove a cube, up to √3
  // times the radius on the diagonals — but by the distance to the light centre, where
  // shadow depth is written. The projection itself does not move by a texel.
  assert.equal(enveloppe, nu);
});

test("the audit's diagonal point passes the projection and falls outside the sphere, a closer point falls in", () => {
  // Reproduction of repros.mts (audit VERIFICATION_STABILISATION_5896648): light at the origin,
  // range 30 m, emitter radius 0.20 m. Point (0.19; 0.18; 0.17) is the one the old recorded
  // near plane rejected from the six faces; it must now be accepted by at least one of them,
  // since the projection now depends only on range.
  const light = validateSceneLight(lanterne(0.2));
  const point = [0.19, 0.18, 0.17] as const;
  const accepted = Array.from({ length: 6 }, (_, face) => {
    const matrices = new Float32Array(16);
    writeFace(matrices, 0, null, 0, light, face, view, 1024);
    const clip = Array.from(
      { length: 4 },
      (_, i) =>
        matrices[i] * point[0] +
        matrices[4 + i] * point[1] +
        matrices[8 + i] * point[2] +
        matrices[12 + i],
    );
    return (
      clip[3] > 0 &&
      Math.abs(clip[0]) <= clip[3] &&
      Math.abs(clip[1]) <= clip[3] &&
      clip[2] >= 0 &&
      clip[2] <= clip[3]
    );
  });
  assert.ok(accepted.some(Boolean), 'the point must belong to at least one face');
  const distance = Math.hypot(...point);
  assert.ok(distance > 0.2, `distance ${distance} should exceed radius 0.2`);
  assert.ok(Math.abs(distance - 0.3121) < 1e-3);
  // A point 0.19 m from the centre, for its part, falls in the sphere: that is the fragment the
  // shadow shader discards (`gpuShadowShader.ts`), not the face that still accepts it.
  assert.ok(Math.hypot(0.19, 0, 0) < 0.2);
});

test("setting the emitter radius alone does stale the light's shadow map", () => {
  const store = createSceneLightStore();
  store.add(validateSceneLight(lanterne()));
  const before = store.epoch;
  store.set('lanterne', { emitterRadius: 0.25 });
  // An identical mutation stales nothing (batch "idempotent mutations"); this one changes the
  // light's shadow map, so it must be seen.
  assert.notEqual(store.epoch, before);
  assert.equal(store.light('lanterne')!.emitterRadius, 0.25);
  const stable = store.epoch;
  store.set('lanterne', { emitterRadius: 0.25 });
  assert.equal(store.epoch, stable);
});
