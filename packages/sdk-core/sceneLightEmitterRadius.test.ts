import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_SETTINGS, type SceneLight } from './sceneLightContracts.ts';
import { validateSceneLight } from './sceneLightValidate.ts';
import { createSceneLightStore } from './sceneLightStore.ts';
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

test("le plan proche d'une carte d'ombre ne vient que de la portée de la lampe", () => {
  // Le réglage de portée 30 m donne le plan proche relevé par le vérificateur : 0,15 m.
  const sans = shadowProjection(Math.PI / 2, 30).near;
  assert.equal(
    sans,
    Math.max(LIGHT_SETTINGS.shadowNearMin, 30 * LIGHT_SETTINGS.shadowNearFraction),
  );
  assert.equal(sans, 0.15);
});

test("la face d'ombre garde ce plan proche, que la lampe déclare une enveloppe ou non", () => {
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
  // L'enveloppe n'est plus retirée par un plan proche relevé — qui retirerait un cube, jusqu'à √3
  // fois le rayon dans les diagonales — mais par la distance au centre de la lampe, là où la
  // profondeur d'ombre s'écrit. La projection, elle, ne bouge pas d'un texel.
  assert.equal(enveloppe, nu);
});

test("le point diagonal de l'audit franchit la projection et tombe hors de la sphère, un point plus proche y tombe", () => {
  // Reproduction de repros.mts (audit VERIFICATION_STABILISATION_5896648) : lampe à l'origine,
  // portée 30 m, rayon d'émetteur 0,20 m. Le point (0,19 ; 0,18 ; 0,17) est celui que l'ancien plan
  // proche relevé rejetait des six faces ; il doit désormais être accepté par au moins une d'elles,
  // puisque la projection ne dépend plus que de la portée.
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
  assert.ok(accepted.some(Boolean), 'le point doit appartenir à au moins une face');
  const distance = Math.hypot(...point);
  assert.ok(distance > 0.2, `distance ${distance} devrait dépasser le rayon 0,2`);
  assert.ok(Math.abs(distance - 0.3121) < 1e-3);
  // Un point à 0,19 m du centre, lui, tombe dans la sphère : c'est le fragment que le nuanceur
  // d'ombre écarte (`gpuShadowShader.ts`), pas la face qui l'accepte tout de même.
  assert.ok(Math.hypot(0.19, 0, 0) < 0.2);
});

test("régler le seul rayon d'émetteur périme bien la carte d'ombre de la lampe", () => {
  const store = createSceneLightStore();
  store.add(validateSceneLight(lanterne()));
  const before = store.epoch;
  store.set('lanterne', { emitterRadius: 0.25 });
  // Une mutation identique ne périme rien (lot « mutations idempotentes ») ; celle-ci change la
  // carte d'ombre de la lampe, donc elle doit être vue.
  assert.notEqual(store.epoch, before);
  assert.equal(store.light('lanterne')!.emitterRadius, 0.25);
  const stable = store.epoch;
  store.set('lanterne', { emitterRadius: 0.25 });
  assert.equal(store.epoch, stable);
});
