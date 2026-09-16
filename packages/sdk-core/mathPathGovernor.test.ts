// Le gouverneur de chemin de calcul (`mathPathGovernor.ts`), horloge injectée et déterministe :
// chaque test construit son propre gouverneur, sans jamais lire une vraie horloge du fil.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATH_EXPLORE_EVERY,
  PATH_MIN_SAMPLES,
  PATH_SWITCH_RUNS,
  createPathGovernor,
} from './mathPathGovernor.ts';

/** Horloge fine (pas de 1 µs) : sa résolution passe sous le seuil d'arbitrage. */
function horlogeFine() {
  let t = 0;
  return () => (t += 0.001);
}

/** Horloge grossière (pas de 1 ms) : sa résolution reste au-dessus du seuil d'arbitrage. */
function horlogeGrossiere() {
  let t = 0;
  return () => (t += 1);
}

/** N observations identiques du même chemin, pour établir ou nourrir sa médiane. */
function observeN(
  gouverneur: ReturnType<typeof createPathGovernor>,
  path: 'js' | 'wasm',
  ms: number,
  fois: number,
) {
  for (let i = 0; i < fois; i++) gouverneur.observe('op', path, ms, 10);
}

test('sous PATH_MIN_SAMPLES échantillons sur l’autre chemin, aucune bascule', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, 1); // établit le chemin courant
  observeN(g, 'wasm', 5, PATH_MIN_SAMPLES - 1); // wasm nettement plus rapide, mais encore trop peu mesuré
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.metrics().operations.op.switches, 0);
});

test('bascule après cinq passages consécutifs à au moins 20 % d’avance', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES); // médiane JS = 10 ns/élément
  // Quatre observations amènent wasm à PATH_MIN_SAMPLES échantillons ; les cinq suivantes sont les
  // passages consécutifs à 21 % d'avance (7,9 < 10 · (1 - 0,2) = 8).
  observeN(g, 'wasm', 7.9, PATH_MIN_SAMPLES - 1 + PATH_SWITCH_RUNS);
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'wasm');
  assert.equal(op.switches, 1);
});

test('ne bascule pas à 19 % d’avance, même après de nombreux passages', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES);
  // 8,1 = 10 · (1 - 0,19) : sous le seuil de 20 %, aucun passage ne qualifie.
  observeN(g, 'wasm', 8.1, PATH_MIN_SAMPLES - 1 + PATH_SWITCH_RUNS * 2);
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'js');
  assert.equal(op.switches, 0);
});

test('ne bascule pas après seulement quatre passages qualifiants', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_MIN_SAMPLES);
  observeN(g, 'wasm', 7.9, PATH_MIN_SAMPLES - 1 + (PATH_SWITCH_RUNS - 1));
  const op = g.metrics().operations.op;
  assert.equal(op.path, 'js');
  assert.equal(op.switches, 0);
});

test('exploration passive une fois sur PATH_EXPLORE_EVERY, sans changer le chemin courant', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  observeN(g, 'js', 10, PATH_EXPLORE_EVERY - 1); // égalise runs à PATH_EXPLORE_EVERY - 1
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.choose('op'), 'wasm', 'le passage d’exploration joue l’autre chemin');
  assert.equal(g.metrics().operations.op.path, 'js', 'choose() ne change jamais le chemin courant');
});

test('repli JS quand le module WebAssembly est absent', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(false, null, 'module WebAssembly indisponible');
  assert.equal(g.choose('op'), 'js');
});

test('repli JS quand l’horloge est trop grossière pour arbitrer', () => {
  const g = createPathGovernor(horlogeGrossiere(), 'auto');
  g.setWasm(true, true, null);
  assert.equal(g.metrics().clockCoarse, true);
  assert.equal(g.choose('op'), 'js');
});

test('un chrono manquant (ms null) fait retomber l’opération sur JS', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  g.observe('op', 'wasm', null, 10);
  assert.equal(g.metrics().operations.op.path, 'js');
  assert.equal(g.choose('op'), 'js');
});

test("mathPath: 'js' force le chemin JavaScript même si Wasm est disponible", () => {
  const g = createPathGovernor(horlogeFine(), 'js');
  g.setWasm(true, true, null);
  assert.equal(g.choose('op'), 'js');
});

test("mathPath: 'wasm' force le chemin Wasm quand il est disponible, sinon retombe sur JS", () => {
  const disponible = createPathGovernor(horlogeFine(), 'wasm');
  disponible.setWasm(true, true, null);
  assert.equal(disponible.choose('op'), 'wasm');

  const absent = createPathGovernor(horlogeFine(), 'wasm');
  absent.setWasm(false, null, 'module WebAssembly indisponible');
  assert.equal(absent.choose('op'), 'js');
});

test('les métriques sont null pour ce qui n’a jamais été mesuré, et une opération inconnue n’existe pas', () => {
  const g = createPathGovernor(horlogeFine(), 'auto');
  g.setWasm(true, true, null);
  g.observe('op', 'js', 10, 10);
  const op = g.metrics().operations.op;
  assert.equal(op.jsNsPerElement, 1e6); // 10 ms sur 10 éléments : (10 · 1e6 ns) / 10 = 1e6 ns/élément
  assert.equal(op.wasmNsPerElement, null);
  assert.equal(op.wasmSamples, 0);
  assert.equal(g.metrics().operations['jamaisAppelee'], undefined);
});
