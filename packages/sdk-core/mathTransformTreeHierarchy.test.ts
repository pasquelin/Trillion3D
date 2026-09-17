// Lot M3a, cas parent/enfant : les mêmes opérations rejouées sur de vrais `Object3D` et caméras de
// Three.js (`hierarchieRejeuThree.mjs`) et sur la hiérarchie de sdk-core (`hierarchieRejeuNous.mjs`),
// comparées composante par composante avec `Object.is` — `NaN` accepté des deux côtés à la même place.
// Les scénarios (`hierarchieScenarios*.mjs`) couvrent : chaînes de profondeur ≥ 4 avec branche à deux
// enfants, échelle négative sur un axe et échelle nulle, rotation parente sur échelle non uniforme,
// caméra enfant d’un nœud, reparentage, marquage partiel (`updateWorldMatrix`), `lookAt` (direction
// colinéaire au haut, parent en miroir, parent d’échelle nulle), et projections dégénérées dans les
// deux conventions de profondeur. Three n’est utilisé qu’en référence, jamais dans un fichier `math*.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joueNous } from '../sdk-browser/bench/appui/hierarchieRejeuNous.mjs';
import { joueThree } from '../sdk-browser/bench/appui/hierarchieRejeuThree.mjs';
import { chainesFigees } from '../sdk-browser/bench/appui/hierarchieScenarios.mjs';
import { objectifs, visees } from '../sdk-browser/bench/appui/hierarchieScenariosCamera.mjs';
import {
  marquages,
  scenarioVivant,
} from '../sdk-browser/bench/appui/hierarchieScenariosVivants.mjs';

type Sortie = number[];

function compare(scenario: unknown[], label: string) {
  const attendu = joueThree(scenario) as Sortie[];
  const obtenu = joueNous(scenario) as Sortie[];
  assert.equal(obtenu.length, attendu.length, `${label} : nombre de sorties`);
  for (let i = 0; i < attendu.length; i++) {
    const a = attendu[i],
      b = obtenu[i];
    assert.equal(b.length, a.length, `${label}, sortie ${i} : longueur`);
    for (let k = 0; k < a.length; k++)
      assert.ok(Object.is(a[k], b[k]), `${label}, sortie ${i}[${k}] : ${a[k]} ≠ ${b[k]}`);
  }
}

test('chaînes figées finies : profondeur ≥ 4, branche à deux enfants, échelle négative et nulle, rotation parente sur échelle non uniforme, caméra enfant — identique à Three au bit près', () => {
  const scenario = chainesFigees(false);
  assert.ok(scenario.length > 500, `${scenario.length} opérations, scénario trop petit`);
  compare(scenario, 'chainesFigees(false)');
});

test('chaînes figées avec NaN et infinis : mêmes NaN et infinis à la même place des deux côtés', () => {
  compare(chainesFigees(true), 'chainesFigees(true)');
});

test('scène vivante : reparentage, marquage partiel (updateWorldMatrix), retraits, lookAt, images de caméra — instantanés identiques à Three, image après image', () => {
  compare(scenarioVivant(60, 14, 6), 'scenarioVivant ordinaire');
});

test('scène vivante hostile : poses NaN/infinies plus fréquentes — toujours identique à Three', () => {
  compare(scenarioVivant(40, 10, 3), 'scenarioVivant hostile');
});

test('règles de marquage exactes : matrixWorldNeedsUpdate, force, sous-arbre détaché, rattachement sous un indice supérieur, retrait puis réemploi — identique à Three', () => {
  compare(marquages(), 'marquages');
});

test('visées : lookAt objet et caméra, cibles ordinaires/sur l’œil/NaN/infinies, haut colinéaire, parent en miroir et d’échelle nulle — identique à Three', () => {
  compare(visees(), 'visees');
});

test('projections : champ, rapport, near/far et zoom ordinaires et dégénérés, WebGL et WebGPU, vue, vue-projection et plans — identique à Three', () => {
  compare(objectifs(), 'objectifs');
});
