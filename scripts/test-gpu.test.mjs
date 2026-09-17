import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_ECARTES,
  DOUBLE_PERIME,
  MONTAGE,
  RACINE,
  REGRESSION,
  buildTestGpuArgs,
  listBrowserFiles,
  listBrowserTests,
  listJustesseTests,
} from './test-gpu.mjs';

test('chaque sonde listée existe et porte le nom que la convention exige', () => {
  const sondes = listJustesseTests();
  assert.ok(sondes.length > 0, 'aucune sonde trouvée');
  for (const sonde of sondes) {
    assert.match(sonde, /^test\/justesse\/.*-.*\.mjs$/);
    assert.ok(existsSync(join(RACINE, sonde)), `${sonde} n'existe pas`);
  }
});

// La garde qui compte : un fichier de `test/justesse/` que le tiret écarte doit être le module
// d'appui de quelqu'un — importé, ou donné en entrée à esbuild pour la page du navigateur. Sans
// elle, une sonde mal nommée ne serait jamais lancée, en silence. Répliquer ici le filtre de
// `listJustesseTests` ne l'attraperait pas : le test se comparerait au code qu'il vérifie.
test('aucun fichier de test/justesse ne reste orphelin : lancé, ou nommé par une sonde', () => {
  const dossier = join(RACINE, 'test/justesse');
  const tous = readdirSync(dossier).filter((f) => f.endsWith('.mjs'));
  const lances = new Set(listJustesseTests().map((s) => s.slice('test/justesse/'.length)));
  // Les consommateurs d'un module d'appui ne sont pas tous dans le dossier : les jeux de cas
  // partagés sont relus par des tests unitaires et par les tests de rendu.
  const suivis = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => /\.(mjs|ts|mts)$/.test(f));
  const textes = new Map(suivis.map((f) => [f, readFileSync(join(RACINE, f), 'utf8')]));
  for (const fichier of tous) {
    if (lances.has(fichier)) continue;
    const nomme = suivis.some(
      (autre) => !autre.endsWith(`/${fichier}`) && textes.get(autre).includes(fichier),
    );
    assert.ok(nomme, `${fichier} n'est ni lancé ni nommé ailleurs : il ne s'exécute jamais`);
  }
});

test('chaque preuve de rendu lancée existe et porte le nom que la convention exige', () => {
  const lancees = listBrowserTests();
  assert.ok(lancees.length > 0, 'aucune preuve de rendu trouvée');
  for (const cible of lancees) {
    assert.match(cible, /^test\/browser\/[a-z0-9]+(-[a-z0-9]+)*\.browser\.mjs$/);
    assert.ok(existsSync(join(RACINE, cible)), `${cible} n'existe pas`);
  }
});

// La garde qui compte, jumelle de celle de `test/justesse` : le dossier tout entier est soit lancé,
// soit écarté avec un motif. Sans elle, une preuve oubliée ne s'exécute jamais, en silence — ce qui
// est arrivé à dix d'entre elles pendant la réorganisation des tests.
test('aucune preuve de rendu ne disparaît : chaque fichier est lancé ou écarté avec son motif', () => {
  const surDisque = listBrowserFiles().map((f) => f.slice(0, -'.browser.mjs'.length));
  const lancees = new Set(
    listBrowserTests().map((c) => c.slice('test/browser/'.length, -'.browser.mjs'.length)),
  );
  for (const nom of surDisque)
    assert.ok(
      lancees.has(nom) || BROWSER_ECARTES.has(nom),
      `${nom} n'est ni lancé ni écarté : il ne s'exécute jamais`,
    );
  assert.equal(lancees.size + BROWSER_ECARTES.size, surDisque.length);
});

test("aucun écart ne survit au fichier qu'il nomme, et chacun dit son genre", () => {
  const surDisque = new Set(listBrowserFiles().map((f) => f.slice(0, -'.browser.mjs'.length)));
  for (const [nom, [genre, motif]] of BROWSER_ECARTES) {
    assert.ok(surDisque.has(nom), `${nom} est écarté mais n'existe plus : retirer l'entrée`);
    assert.ok(
      [MONTAGE, REGRESSION, DOUBLE_PERIME].includes(genre),
      `${nom} : genre inconnu ${genre}`,
    );
    assert.ok(motif.length > 10, `${nom} : motif trop court pour dire quoi que ce soit`);
  }
});

test('buildTestGpuArgs construit la liste complète par défaut, en série', () => {
  const args = buildTestGpuArgs([]);
  assert.deepEqual(args.slice(0, 3), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
  ]);
  assert.ok(args.includes('test/browser/cisaillement-transform.browser.mjs'));
  assert.ok(args.some((a) => a.includes('erreur-ecran-borne.mjs')));
  assert.equal(args.length, 3 + listJustesseTests().length + listBrowserTests().length);
});

test('buildTestGpuArgs transmet les cibles fournies en ligne de commande', () => {
  assert.deepEqual(buildTestGpuArgs(['test/justesse/reflexion-cone.mjs']), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'test/justesse/reflexion-cone.mjs',
  ]);
});
