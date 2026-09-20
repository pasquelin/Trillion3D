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

test('each listed probe exists and bears the name required by convention', () => {
  const sondes = listJustesseTests();
  assert.ok(sondes.length > 0, 'no probe found');
  for (const sonde of sondes) {
    assert.match(sonde, /^test\/justesse\/.*-.*\.mjs$/);
    assert.ok(existsSync(join(RACINE, sonde)), `${sonde} does not exist`);
  }
});

// The count that matters: a file in `test/justesse/` skipped by hyphen must be someone's support module —
// imported, or given as input to esbuild for the browser page. Without it, a misnamed probe would never run, silently.
test('no test/justesse file remains orphaned: run, or named by a probe', () => {
  const dossier = join(RACINE, 'test/justesse');
  const tous = readdirSync(dossier).filter((f) => f.endsWith('.mjs'));
  const lances = new Set(listJustesseTests().map((s) => s.slice('test/justesse/'.length)));
  // Support module consumers are not all in the directory: shared case sets are re-read by unit tests and render tests.
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
    assert.ok(nomme, `${fichier} is neither launched nor named elsewhere: it never runs`);
  }
});

test('each run render proof exists and bears the name required by convention', () => {
  const lancees = listBrowserTests();
  assert.ok(lancees.length > 0, 'no render proof found');
  for (const cible of lancees) {
    assert.match(cible, /^test\/browser\/[a-z0-9]+(-[a-z0-9]+)*\.browser\.mjs$/);
    assert.ok(existsSync(join(RACINE, cible)), `${cible} does not exist`);
  }
});

// The count that matters, twin of `test/justesse`: the entire directory is either run or excluded with a reason.
// Without it, a forgotten proof never executes, silently — which happened to ten of them during test reorganization.
test('no render proof disappears: each file is run or discarded with its reason', () => {
  const surDisque = listBrowserFiles().map((f) => f.slice(0, -'.browser.mjs'.length));
  const lancees = new Set(
    listBrowserTests().map((c) => c.slice('test/browser/'.length, -'.browser.mjs'.length)),
  );
  for (const nom of surDisque)
    assert.ok(
      lancees.has(nom) || BROWSER_ECARTES.has(nom),
      `${nom} is neither launched nor excluded: it never runs`,
    );
  assert.equal(lancees.size + BROWSER_ECARTES.size, surDisque.length);
});

test('no exclusion outlives the file it names, and each states its category', () => {
  const surDisque = new Set(listBrowserFiles().map((f) => f.slice(0, -'.browser.mjs'.length)));
  for (const [nom, [genre, motif]] of BROWSER_ECARTES) {
    assert.ok(surDisque.has(nom), `${nom} is excluded but no longer exists: remove the entry`);
    assert.ok(
      [MONTAGE, REGRESSION, DOUBLE_PERIME].includes(genre),
      `${nom}: unknown kind ${genre}`,
    );
    assert.ok(motif.length > 10, `${nom}: reason too short to state anything`);
  }
});

test('buildTestGpuArgs builds the complete list by default, serially', () => {
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

test('buildTestGpuArgs passes targets provided on the command line', () => {
  assert.deepEqual(buildTestGpuArgs(['test/justesse/reflexion-cone.mjs']), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'test/justesse/reflexion-cone.mjs',
  ]);
});
