import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_SETTINGS, type SceneLight } from './sceneLightContracts.ts';
import { validateSceneLight } from './sceneLightValidate.ts';
import { shadowProjection } from './sceneLightShadowMath.ts';
import { writeFace } from './sceneLightShadowFaces.ts';

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

test("le rayon d'émetteur traverse la validation, et n'est accepté que dans (0, portée)", () => {
  assert.equal(validateSceneLight(lanterne(0.2)).emitterRadius, 0.2);
  assert.equal(validateSceneLight(lanterne()).emitterRadius, undefined);
  for (const refuse of [0, -1, 30, 45, Number.NaN])
    assert.throws(() => validateSceneLight(lanterne(refuse)), /rayon d'émetteur/);
});

test("une lampe directionnelle n'a pas d'enveloppe, et le contrat refuse de lui en prêter une", () => {
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

test("le plan proche d'une carte d'ombre monte au rayon d'émetteur, et jamais en dessous", () => {
  // Le réglage de portée 30 m donne le plan proche relevé par le vérificateur : 0,15 m.
  const sans = shadowProjection(Math.PI / 2, 30).near;
  assert.equal(
    sans,
    Math.max(LIGHT_SETTINGS.shadowNearMin, 30 * LIGHT_SETTINGS.shadowNearFraction),
  );
  assert.equal(sans, 0.15);
  // Les parois de la lanterne se tiennent à 0,1464 m et 0,1526 m : sans le champ, elles entrent
  // dans la carte et éteignent leur propre lampe.
  assert.ok(0.1526 > sans && 0.14643 < sans);
  assert.equal(shadowProjection(Math.PI / 2, 30, 0.25).near, 0.25);
  // Un rayon plus petit que le plan proche dérivé de la portée ne l'abaisse pas.
  assert.equal(shadowProjection(Math.PI / 2, 30, 0.05).near, 0.15);
});

test("la face d'ombre d'une lampe reprend le plan proche que son enveloppe impose", () => {
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
  assert.equal(enveloppe, 0.25);
  // Toute la géométrie de l'enveloppe tombe devant ce plan : la découpe de profondeur l'écarte de
  // la carte, la lampe éclaire le sol autour d'elle, et rien d'autre dans la scène ne change.
  assert.ok(enveloppe > 0.1526);
});
