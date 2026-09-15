// Banc du lot M1 « socle mathématique », en deux parties dans un même script.
//
// 1. Équivalence : chaque fonction du socle contre la méthode de la bibliothèque de référence qu'elle
//    remplacera, hiérarchies parent/enfant comprises, et chaque consommateur rattaché contre son code
//    d'avant. Un seul bit d'écart non expliqué fait échouer le script ; les écarts expliqués sont
//    chiffrés et bornés par `socleEcarts.mjs`.
// 2. Performance : même travail des deux côtés, opération seule, lots de 1 000, 10 000 et 100 000,
//    chaîne parent/enfant complète ; ns/op et octets/op, médiane et p95, tableau en console et JSON.
//    Elle tourne dans un processus neuf lancé par ce script, avec `--expose-gc` : la première partie
//    appelle le socle avec toutes sortes de tableaux, et ce passé fausserait le chronomètre.
//
// `SOCLE_COURT=1` ne fait que vérifier que le script tourne : quelques répétitions, rien à citer. JSON
// et tableau vont sous `.mesure/out/calculs/`, hors dépôt. La campagne officielle se lance sans lui,
// sous le verrou de mesure, machine calme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.SOCLE_PARTIE === 'performance') {
  const { entete, publie } = await import('./socleMesure.mjs');
  const { lignesPerformance } = await import('./soclePerf.mjs');
  publie(entete(), lignesPerformance());
} else {
  const { verifieEtDeposeFormules } = await import('../../sdk-core/bench/bancFormules.mjs');
  const { lignesEquivalence, noeudsHierarchie } = await import('./socleEquivalence.mjs');
  const { lignesConsommateursCore } = await import('./socleConsommateursCore.mjs');
  const { lignesConsommateursBrowser } = await import('./socleConsommateursBrowser.mjs');
  await import('./socleEcarts.mjs');
  const lignes = [
    ...(await lignesEquivalence()),
    ...(await lignesConsommateursCore()),
    ...(await lignesConsommateursBrowser()),
  ];
  verifieEtDeposeFormules(
    'socle-math',
    `le socle rend les bits de la référence et du code qu'il remplace (${noeudsHierarchie.length} nœuds hiérarchiques)`,
    lignes,
  );
  const performance = spawnSync(
    process.execPath,
    ['--expose-gc', '--experimental-strip-types', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, SOCLE_PARTIE: 'performance' } },
  );
  test('la partie performance a tourné jusqu’au bout', () => assert.equal(performance.status, 0));
}
