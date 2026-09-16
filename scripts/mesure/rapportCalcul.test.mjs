// Le tableau du chemin de calcul (`rapportCalcul.mjs`) : il publie ce que le gouverneur a choisi,
// opération par opération, et ne remplace jamais une médiane non mesurée par un zéro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cheminsCalcul } from './rapportCalcul.mjs';

/** Un rapport réduit à ce que `cheminsCalcul` lit : une série, un côté, son relevé. */
const rapport = (cheminCalcul) => ({
  series: [{ view: 'salon', pixelError: 1, sides: { a: { cheminCalcul } } }],
});

/** Un relevé de gouverneur, complété par ce que le cas veut montrer. */
const releve = (fields) => ({
  contract: 1,
  mode: 'auto',
  wasmAvailable: true,
  wasmSimd: true,
  clockResolutionMs: 0.005,
  clockCoarse: false,
  unavailableReason: null,
  operations: {},
  ...fields,
});

/** Une opération, complétée par ce que le cas veut montrer. */
const operation = (fields) => ({
  path: 'wasm',
  jsNsPerElement: null,
  wasmNsPerElement: null,
  jsSamples: 0,
  wasmSamples: 0,
  switches: 0,
  elements: 0,
  ...fields,
});

test('le chemin choisi et les deux médianes sont publiés, opération par opération', () => {
  const lignes = cheminsCalcul(
    rapport(
      releve({
        operations: {
          hierarchyUpdateBatch: operation({
            path: 'wasm',
            jsNsPerElement: 41.25,
            wasmNsPerElement: 12.5,
            switches: 1,
            elements: 4096,
          }),
        },
      }),
    ),
  ).join('\n');
  assert.match(
    lignes,
    /\| auto \| chargé, simd128 \| hierarchyUpdateBatch \| wasm \| 41\.3 \| 12\.5 \| 1 \| 4096 \|/,
  );
});

test('une médiane non mesurée est dite « non mesuré », jamais zéro, et la cause du repli est publiée', () => {
  const lignes = cheminsCalcul(
    rapport(
      releve({
        mode: 'js',
        wasmAvailable: false,
        wasmSimd: null,
        clockCoarse: true,
        unavailableReason: 'module WebAssembly indisponible',
        operations: {
          boxTransformBatch: operation({ path: 'js', jsNsPerElement: 30, elements: 12 }),
        },
      }),
    ),
  ).join('\n');
  assert.match(
    lignes,
    /\| js \| module WebAssembly indisponible \| boxTransformBatch \| js \| 30\.0 \| non mesuré \| 0 \| 12 \|/,
  );
});

test('une horloge trop grossière pour arbitrer est publiée avec le module, pas tue', () => {
  const lignes = cheminsCalcul(rapport(releve({ clockCoarse: true }))).join('\n');
  assert.match(
    lignes,
    /\| auto \| chargé, simd128, horloge trop grossière pour arbitrer \| aucun lot joué \|/,
  );
});

test('un côté sans relevé le dit, au lieu de laisser croire au chemin JavaScript', () => {
  assert.match(cheminsCalcul(rapport(null)).join('\n'), /\| relevé absent de ce dist \|/);
});
