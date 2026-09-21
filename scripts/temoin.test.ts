// The Three reference witness receives lights from contract: one test per behavior, headless.
import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { creerEclairageTemoin } from './mesure/pageTemoin.ts';
import type { Explorer } from '../packages/sdk-browser/index.ts';

const DOUCEUR = 0.02;

interface LightRecord {
  id: string;
  kind: 'point' | 'directional' | 'spot';
  position?: number[];
  direction?: number[];
  color: number[];
  intensity: number;
  range?: number;
  coneAngle?: number;
  castsShadow: boolean;
}

interface Backend {
  refreshSceneLighting: () => void;
}

/** A paper explorer: light store, published settings, backends to notify. */
function explorateur(lights: LightRecord[], backends: Backend[] = []): Explorer {
  return {
    lights: () => lights.map((light) => ({ ...light })),
    lightSettings: { spotEdgeSoftness: DOUCEUR },
    backends,
  } as unknown as Explorer;
}

const PONCTUELLE: LightRecord = {
  id: 'p1',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 40,
  range: 12,
  castsShadow: true,
};
const SOLEIL: LightRecord = {
  id: 's',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 3,
  castsShadow: true,
};
const PROJECTEUR: LightRecord = {
  id: 'j',
  kind: 'spot',
  position: [0, 5, 0],
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 20,
  range: 10,
  coneAngle: 0.5,
  castsShadow: false,
};

test('a point light from contract becomes a Three light with same range and decay', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([PONCTUELLE]));
  const [lampe] = eclairage.groupe.children as THREE.PointLight[];
  assert.ok(lampe.isPointLight);
  assert.deepStrictEqual(lampe.position.toArray(), [1, 2, 3]);
  assert.strictEqual(lampe.distance, 12);
  assert.strictEqual(lampe.decay, 2);
  assert.strictEqual(lampe.intensity, 40);
  assert.deepStrictEqual([lampe.color.r, lampe.color.g, lampe.color.b], [1, 0.5, 0.25]);
});

test('a directional light is placed opposite to its propagation, target at origin', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([SOLEIL]));
  const [lampe] = eclairage.groupe.children as THREE.DirectionalLight[];
  assert.ok(lampe.isDirectionalLight);
  // `-0` and `0` are the same position: comparison concerns values, not sign.
  assert.deepStrictEqual(
    lampe.position.toArray().map((valeur: number) => valeur + 0),
    [0, 1, 0],
  );
  assert.deepStrictEqual(lampe.target.position.toArray(), [0, 0, 0]);
});

test('a spot light preserves half-angle and edge softness from engine', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([PROJECTEUR]));
  const [lampe] = eclairage.groupe.children as THREE.SpotLight[];
  assert.ok(lampe.isSpotLight);
  assert.strictEqual(lampe.angle, 0.5);
  // Three softens from `cos(angle)` to `cos(angle(1 − penumbra))`; engine from `cos θ` to `cos θ + softness`.
  const bord = Math.cos(lampe.angle * (1 - lampe.penumbra));
  assert.ok(Math.abs(bord - (Math.cos(0.5) + DOUCEUR)) < 1e-9, `bord ${bord}`);
  assert.deepStrictEqual(lampe.target.position.toArray(), [0, -5, 0]);
});

test('no cast shadows on witness side: SDK Three renderer has no maps', () => {
  const eclairage = creerEclairageTemoin();
  const resume = eclairage.suivre(explorateur([PONCTUELLE, SOLEIL]));
  assert.strictEqual(resume?.ombres, false);
  for (const lampe of eclairage.groupe.children as THREE.Light[])
    assert.strictEqual(lampe.castShadow, false);
});

test('summary counts received lights by type in store order', () => {
  const eclairage = creerEclairageTemoin();
  const resume = eclairage.suivre(explorateur([PONCTUELLE, SOLEIL, PROJECTEUR]));
  assert.deepStrictEqual(resume, {
    nombre: 3,
    ponctuelles: 1,
    projecteurs: 1,
    directionnelles: 1,
    ids: ['p1', 's', 'j'],
    ombres: false,
  });
});

test('moving a light does not trigger a scene refresh, adding one does', () => {
  let reprises = 0;
  const backend = { refreshSceneLighting: () => reprises++ };
  const lights = [{ ...PONCTUELLE }];
  const explorer = explorateur(lights, [backend]);
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorer);
  assert.strictEqual(reprises, 1);
  lights[0].position = [9, 9, 9];
  eclairage.suivre(explorer);
  assert.strictEqual(reprises, 1);
  assert.deepStrictEqual(eclairage.groupe.children[0].position.toArray(), [9, 9, 9]);
  lights.push({ ...SOLEIL });
  eclairage.suivre(explorer);
  assert.strictEqual(reprises, 2);
  assert.strictEqual(eclairage.groupe.children.length, 2);
});

test('a dist prior to contract returns null, never an invented count', () => {
  const eclairage = creerEclairageTemoin();
  assert.strictEqual(eclairage.suivre({ backends: [] } as unknown as Explorer), null);
  assert.strictEqual(eclairage.groupe.children.length, 0);
});
