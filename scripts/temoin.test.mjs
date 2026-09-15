// Le témoin Three reçoit les lampes du contrat : un test par comportement, sans navigateur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { creerEclairageTemoin } from './mesure/pageTemoin.mjs';

const DOUCEUR = 0.02;

/** Un explorateur de papier : le magasin de lampes, les réglages publiés, les moteurs à prévenir. */
function explorateur(lights, backends = []) {
  return {
    lights: () => lights.map((light) => ({ ...light })),
    lightSettings: { spotEdgeSoftness: DOUCEUR },
    backends,
  };
}

const PONCTUELLE = {
  id: 'p1',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 40,
  range: 12,
  castsShadow: true,
};
const SOLEIL = {
  id: 's',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 3,
  castsShadow: true,
};
const PROJECTEUR = {
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

test('une ponctuelle du contrat devient une lampe Three de même portée et décroissance', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([PONCTUELLE]));
  const [lampe] = eclairage.groupe.children;
  assert.ok(lampe.isPointLight);
  assert.deepStrictEqual(lampe.position.toArray(), [1, 2, 3]);
  assert.strictEqual(lampe.distance, 12);
  assert.strictEqual(lampe.decay, 2);
  assert.strictEqual(lampe.intensity, 40);
  assert.deepStrictEqual([lampe.color.r, lampe.color.g, lampe.color.b], [1, 0.5, 0.25]);
});

test('une directionnelle est posée à l’opposé de sa propagation, cible à l’origine', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([SOLEIL]));
  const [lampe] = eclairage.groupe.children;
  assert.ok(lampe.isDirectionalLight);
  // `-0` et `0` sont la même position : la comparaison porte sur les valeurs, pas leur signe.
  assert.deepStrictEqual(
    lampe.position.toArray().map((valeur) => valeur + 0),
    [0, 1, 0],
  );
  assert.deepStrictEqual(lampe.target.position.toArray(), [0, 0, 0]);
});

test('un projecteur reprend le demi-angle et le bord de cône du moteur', () => {
  const eclairage = creerEclairageTemoin();
  eclairage.suivre(explorateur([PROJECTEUR]));
  const [lampe] = eclairage.groupe.children;
  assert.ok(lampe.isSpotLight);
  assert.strictEqual(lampe.angle, 0.5);
  // Three adoucit de `cos(angle)` à `cos(angle(1 − pénombre))` ; le moteur, de `cos θ` à `cos θ + douceur`.
  const bord = Math.cos(lampe.angle * (1 - lampe.penumbra));
  assert.ok(Math.abs(bord - (Math.cos(0.5) + DOUCEUR)) < 1e-9, `bord ${bord}`);
  assert.deepStrictEqual(lampe.target.position.toArray(), [0, -5, 0]);
});

test('aucune ombre portée côté témoin : le renderer Three du SDK n’a pas de cartes', () => {
  const eclairage = creerEclairageTemoin();
  const resume = eclairage.suivre(explorateur([PONCTUELLE, SOLEIL]));
  assert.strictEqual(resume.ombres, false);
  for (const lampe of eclairage.groupe.children) assert.strictEqual(lampe.castShadow, false);
});

test('le résumé compte les lampes reçues par type, dans l’ordre du magasin', () => {
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

test('un déplacement ne demande pas de reprise, un ajout en demande une', () => {
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

test('un dist antérieur au contrat rend null, jamais un compte inventé', () => {
  const eclairage = creerEclairageTemoin();
  assert.strictEqual(eclairage.suivre({ backends: [] }), null);
  assert.strictEqual(eclairage.groupe.children.length, 0);
});
