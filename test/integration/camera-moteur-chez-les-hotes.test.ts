import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navigateur = new URL('../browser/', import.meta.url);

// Defect fixed in 5fecd558: four hosts in `test/browser/*.browser.ts` called
// `cameraSelectionUniforms`/`rasterVisibility` with a raw `THREE.PerspectiveCamera` — these APIs
// expect an `EngineCamera` since M3b, resulting in silently undefined `cam.planes` and `page.matrix`.
// This test is structural (source reading, no execution — those hosts require Chromium WebGPU):
// it checks that the call site goes through `cameraMoteur(...)` or through `vue`
// (itself `cameraMoteur(camera)`, see `inverseTransposeCas.ts`), never through raw host camera.

test('cisaillement-transform.browser.ts and cone-echelle-non-uniforme.browser.ts call cameraSelectionUniforms(cameraMoteur(...))', async () => {
  const cases: readonly [string, number][] = [
    ['cisaillement-transform.browser.ts', 1],
    ['cone-echelle-non-uniforme.browser.ts', 2],
  ];
  for (const [fichier, attendus] of cases) {
    const texte = await readFile(new URL(fichier, navigateur), 'utf8');
    assert.match(
      texte,
      /import \{ cameraMoteur \} from '\.\.\/\.\.\/packages\/sdk-browser\/cameraFixture\.ts'/,
      `${fichier} must import cameraMoteur`,
    );
    const appels = texte.match(/cameraSelectionUniforms\(\s*cameraMoteur\(/g) ?? [];
    assert.equal(appels.length, attendus, `${fichier}: all calls must go through cameraMoteur`);
    // Witness: no call passes the raw host camera anymore (the defect before 5fecd558).
    assert.doesNotMatch(
      texte,
      /cameraSelectionUniforms\(\s*camera\s*,/,
      `${fichier}: no call must pass the raw host camera`,
    );
  }
});

test('inverse-transposee-petite-echelle.browser.ts calls cameraSelectionUniforms(vue, ...), not host camera', async () => {
  const texte = await readFile(
    new URL('inverse-transposee-petite-echelle.browser.ts', navigateur),
    'utf8',
  );
  assert.match(texte, /\bvue,\n/, 'must import `vue` from inverseTransposeCas.ts');
  assert.doesNotMatch(
    texte,
    /\bcamera,\n/,
    'must no longer import `camera` from inverseTransposeCas.ts',
  );
  assert.match(texte, /cameraSelectionUniforms\(\s*vue\s*,/, 'the call must pass `vue`');
  assert.doesNotMatch(
    texte,
    /cameraSelectionUniforms\(\s*camera\s*,/,
    'no call must pass a raw host camera',
  );
});

test('reflexion-face-eliminee.browser.ts calls rasterVisibility(..., vue, ...), not host camera', async () => {
  const texte = await readFile(new URL('reflexion-face-eliminee.browser.ts', navigateur), 'utf8');
  assert.match(
    texte,
    /import \{ decisionCpu, vue \} from '\.\.\/justesse\/inverseTransposeCas\.ts'/,
    'must import `vue`, not `camera`',
  );
  assert.match(texte, /rasterVisibility\(\[pageVisible\(tousLesCas\[i\]\)\],\s*vue,/);
  assert.doesNotMatch(
    texte,
    /rasterVisibility\([^)]*,\s*camera\s*,/,
    'no call must pass a raw host camera',
  );
});

test('`vue` (inverseTransposeCas.ts) is indeed cameraMoteur(camera), not raw host camera', async () => {
  const texte = await readFile(
    new URL('../justesse/inverseTransposeCas.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    texte,
    /import \{ cameraMoteur \} from '\.\.\/\.\.\/packages\/sdk-browser\/cameraFixture\.ts'/,
  );
  assert.match(texte, /export const vue = cameraMoteur\(camera\);/);
});
