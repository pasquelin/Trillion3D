import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navigateur = new URL('../browser/', import.meta.url);

// Defect fixed in 5fecd558: four hosts in `test/browser/*.browser.mjs` called
// `cameraSelectionUniforms`/`rasterVisibility` with a raw `THREE.PerspectiveCamera` — these APIs
// expect an `EngineCamera` since M3b, resulting in silently undefined `cam.planes` and `page.matrix`.
// This test is structural (source reading, no execution — those hosts require Chromium WebGPU):
// it checks that the call site goes through `cameraMoteur(...)` or through `vue`
// (itself `cameraMoteur(camera)`, see `inverseTransposeCas.mjs`), never through raw host camera.

test('cisaillement-transform.browser.mjs and cone-echelle-non-uniforme.browser.mjs call cameraSelectionUniforms(cameraMoteur(...))', async () => {
  for (const [fichier, attendus] of [
    ['cisaillement-transform.browser.mjs', 1],
    ['cone-echelle-non-uniforme.browser.mjs', 2],
  ]) {
    const texte = await readFile(new URL(fichier, navigateur), 'utf8');
    assert.match(
      texte,
      /import \{ cameraMoteur \} from '\.\.\/\.\.\/packages\/sdk-browser\/cameraFixture\.ts'/,
      `${fichier} doit importer cameraMoteur`,
    );
    const appels = texte.match(/cameraSelectionUniforms\(\s*cameraMoteur\(/g) ?? [];
    assert.equal(appels.length, attendus, `${fichier} : tous les appels passent par cameraMoteur`);
    // Witness: no call passes the raw host camera anymore (the defect before 5fecd558).
    assert.doesNotMatch(
      texte,
      /cameraSelectionUniforms\(\s*camera\s*,/,
      `${fichier}: no call must pass the raw host camera`,
    );
  }
});

test('inverse-transposee-petite-echelle.browser.mjs calls cameraSelectionUniforms(vue, ...), not host camera', async () => {
  const texte = await readFile(
    new URL('inverse-transposee-petite-echelle.browser.mjs', navigateur),
    'utf8',
  );
  assert.match(texte, /\bvue,\n/, 'doit importer `vue` de inverseTransposeCas.mjs');
  assert.doesNotMatch(
    texte,
    /\bcamera,\n/,
    'ne doit plus importer `camera` de inverseTransposeCas.mjs',
  );
  assert.match(texte, /cameraSelectionUniforms\(\s*vue\s*,/, 'l’appel doit passer `vue`');
  assert.doesNotMatch(
    texte,
    /cameraSelectionUniforms\(\s*camera\s*,/,
    'no call must pass a raw host camera',
  );
});

test('reflexion-face-eliminee.browser.mjs calls rasterVisibility(..., vue, ...), not host camera', async () => {
  const texte = await readFile(new URL('reflexion-face-eliminee.browser.mjs', navigateur), 'utf8');
  assert.match(
    texte,
    /import \{ decisionCpu, vue \} from '\.\.\/justesse\/inverseTransposeCas\.mjs'/,
    'doit importer `vue`, pas `camera`',
  );
  assert.match(texte, /rasterVisibility\(\[pageVisible\(tousLesCas\[i\]\)\],\s*vue,/);
  assert.doesNotMatch(
    texte,
    /rasterVisibility\([^)]*,\s*camera\s*,/,
    'no call must pass a raw host camera',
  );
});

test('`vue` (inverseTransposeCas.mjs) is indeed cameraMoteur(camera), not raw host camera', async () => {
  const texte = await readFile(
    new URL('../justesse/inverseTransposeCas.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    texte,
    /import \{ cameraMoteur \} from '\.\.\/\.\.\/packages\/sdk-browser\/cameraFixture\.ts'/,
  );
  assert.match(texte, /export const vue = cameraMoteur\(camera\);/);
});
