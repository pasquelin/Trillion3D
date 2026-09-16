import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const testDir = new URL('../test/', import.meta.url);
const browser = new URL('../packages/sdk-browser/', import.meta.url);

// Défaut corrigé en 5fecd558 : quatre hôtes de `test/*.browser.mjs` appelaient
// `cameraSelectionUniforms`/`rasterVisibility` avec une `THREE.PerspectiveCamera` brute — ces API
// veulent depuis M3b une `EngineCamera`, d'où `cam.planes` et `page.matrix` indéfinis en silence.
// Ce test est structurel (lecture de source, pas d'exécution — ces hôtes veulent `LAB_ROOT` et un
// WebGPU Chromium) : il vérifie que le site d'appel passe par `cameraMoteur(...)` ou par `vue`
// (elle-même `cameraMoteur(camera)`, voir `inverseTransposeCas.mjs`), jamais par la caméra hôte nue.

test('cisaillementTransform.browser.mjs et coneEchelleNonUniforme.browser.mjs appellent cameraSelectionUniforms(cameraMoteur(...))', async () => {
  for (const [fichier, attendus] of [
    ['cisaillementTransform.browser.mjs', 1],
    ['coneEchelleNonUniforme.browser.mjs', 2],
  ]) {
    const texte = await readFile(new URL(fichier, testDir), 'utf8');
    assert.match(
      texte,
      /import \{ cameraMoteur \} from '\.\.\/packages\/sdk-browser\/cameraFixture\.ts'/,
      `${fichier} doit importer cameraMoteur`,
    );
    const appels = texte.match(/cameraSelectionUniforms\(\s*cameraMoteur\(/g) ?? [];
    assert.equal(appels.length, attendus, `${fichier} : tous les appels passent par cameraMoteur`);
    // Témoin : aucun appel ne passe plus la caméra hôte nue (le défaut d'avant 5fecd558).
    assert.doesNotMatch(
      texte,
      /cameraSelectionUniforms\(\s*camera\s*,/,
      `${fichier} : aucun appel ne doit passer la caméra hôte brute`,
    );
  }
});

test('inverseTransposeePetiteEchelle.browser.mjs appelle cameraSelectionUniforms(vue, ...), pas la caméra hôte', async () => {
  const texte = await readFile(new URL('inverseTransposeePetiteEchelle.browser.mjs', testDir), 'utf8');
  assert.match(texte, /\bvue,\n/, 'doit importer `vue` de inverseTransposeCas.mjs');
  assert.doesNotMatch(texte, /\bcamera,\n/, 'ne doit plus importer `camera` de inverseTransposeCas.mjs');
  assert.match(texte, /cameraSelectionUniforms\(\s*vue\s*,/, 'l’appel doit passer `vue`');
  assert.doesNotMatch(
    texte,
    /cameraSelectionUniforms\(\s*camera\s*,/,
    'aucun appel ne doit passer une caméra hôte brute',
  );
});

test('reflexionFaceEliminee.browser.mjs appelle rasterVisibility(..., vue, ...), pas la caméra hôte', async () => {
  const texte = await readFile(new URL('reflexionFaceEliminee.browser.mjs', testDir), 'utf8');
  assert.match(
    texte,
    /import \{ decisionCpu, vue \} from '\.\.\/packages\/sdk-browser\/bench\/justesse\/inverseTransposeCas\.mjs'/,
    'doit importer `vue`, pas `camera`',
  );
  assert.match(texte, /rasterVisibility\(\[pageVisible\(tousLesCas\[i\]\)\],\s*vue,/);
  assert.doesNotMatch(
    texte,
    /rasterVisibility\([^)]*,\s*camera\s*,/,
    'aucun appel ne doit passer une caméra hôte brute',
  );
});

test('`vue` (inverseTransposeCas.mjs) est bien cameraMoteur(camera), pas la caméra hôte nue', async () => {
  const texte = await readFile(new URL('bench/justesse/inverseTransposeCas.mjs', browser), 'utf8');
  assert.match(texte, /import \{ cameraMoteur \} from '\.\.\/\.\.\/cameraFixture\.ts'/);
  assert.match(texte, /export const vue = cameraMoteur\(camera\);/);
});
