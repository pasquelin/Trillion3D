// Isolation de l'exécution de performance en processus neuf.
// Évite la dé-optimisation V8 (polymorphisme des sites d'appels après rejeux d'équivalence).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Relance `metaUrl` dans un processus Node neuf avec une variable d'environnement sentinelle.
 * Fait échouer un test `node:test` si le processus fils échoue (code de sortie !== 0).
 */
export function rejoueEnProcessusNeuf(metaUrl, variable, valeur = 'performance') {
  const resultat = spawnSync(
    process.execPath,
    ['--expose-gc', '--experimental-strip-types', fileURLToPath(metaUrl)],
    { stdio: 'inherit', env: { ...process.env, [variable]: valeur } },
  );
  test('performance en processus neuf sans pollution V8', () =>
    assert.equal(resultat.status, 0));
}
