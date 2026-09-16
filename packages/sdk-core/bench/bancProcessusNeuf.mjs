// Le rejeu d'équivalence d'un banc appelle l'implémentation optimisée avec toutes sortes de formes
// d'entrée (types de tableaux, tailles, chemins hostiles) : V8 polymorphise ses sites d'appel en
// conséquence, et une mesure de performance qui suivrait dans le MÊME processus chronométrerait ce
// passé, pas l'appel réel du moteur (`lookAt` : 0,98× pollué, 1,33× en processus neuf, lot perf-2).
// La partie performance tourne donc toujours dans un processus Node neuf, relancé sur ce même
// fichier avec une variable d'environnement qui lui dit de ne jouer que cette partie-là.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Relance `metaUrl` dans un processus Node neuf, `variable` posée à `valeur` dans son environnement,
 * et fait échouer un test `node --test` si ce processus ne sort pas à zéro. Le script rappelé décide
 * lui-même, en lisant `variable`, de ne jouer que sa partie performance.
 */
export function rejoueEnProcessusNeuf(metaUrl, variable, valeur = 'performance') {
  const resultat = spawnSync(
    process.execPath,
    ['--expose-gc', '--experimental-strip-types', fileURLToPath(metaUrl)],
    { stdio: 'inherit', env: { ...process.env, [variable]: valeur } },
  );
  test('la partie performance a tourné jusqu’au bout, en processus neuf', () =>
    assert.equal(resultat.status, 0));
}
