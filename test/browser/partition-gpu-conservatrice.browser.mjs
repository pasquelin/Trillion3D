// Preuve par le moteur réel : la partition GPU est CONSERVATRICE, cluster par cluster.
//
// La scène du banc (douze instances), la trajectoire du banc, trente poses réparties dessus. Après
// chaque image, `partitionAudit()` rend ce que la carte a écrit pour CHAQUE ligne résidente —
// rectangle d'écran et borne de profondeur — avec les coins monde en double précision et les
// matrices d'où elle l'a tiré. La référence est recalculée sur ces mêmes entrées, et trois règles
// sont comptées sur toutes les lignes de toutes les poses :
//   1. le rectangle de la carte contient celui de la référence ;
//   2. une boîte que la référence dit coupée par le plan proche porte le drapeau de coupe ;
//   3. la profondeur de la carte minore celle de la référence, biais de couche compris.
// Zéro violation est la seule valeur acceptable. Les marges sont rapportées pour elles-mêmes.
//
//   LAB_ROOT=/chemin/vers/render-tech-lab node --experimental-strip-types \
//     test/browser/partitionGpuConservatrice.browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { requireDuLab } from '../justesse/pageWebgpu.mjs';
import { startServer } from '../../scripts/mesure/serveur.mjs';
import { ASSETS, DEFAULT_SCENE, labManifest } from '../../scripts/mesure/scene.mjs';
import { LAB, checkLabPath, poseAt } from '../../scripts/mesure/poses.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SDK_URL = '/sdk/sdk-browser/index.js',
  MODULES_URL = '/preuve/',
  MESURE_URL = '/mesure/';
const POSES = 30;
/** Le dossier d'un paquet installé, cherché comme Node le cherche : de la racine vers le haut. */
function packageDir(name) {
  for (let dir = ROOT; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`paquet introuvable : ${name}`);
  }
}

checkLabPath();
const manifestUrl = labManifest(DEFAULT_SCENE, true);
assert.ok(
  existsSync(join(ROOT, 'dist/sdk-browser/index.js')),
  'dist absent : lancer `pnpm run build` avant cette preuve',
);
// Le module de page est empaqueté depuis les SOURCES du dépôt — esbuild, celui de Vite, pris dans
// le Lab en lecture seule —, si bien qu'il lit la référence de production elle-même plutôt qu'une
// copie. Le paquet est servi comme un fichier ordinaire, au même titre que le dist.
const esbuild = createRequire(requireDuLab().resolve('vite'))('esbuild');
const paquet = await esbuild.build({
  entryPoints: [join(ROOT, 'test/browserFixtures/partitionConservatricePage.mjs')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
});
const preuveDir = await mkdtemp(join(tmpdir(), 'wg-preuve-partition-'));
await writeFile(join(preuveDir, 'audit.js'), paquet.outputFiles[0].text);

const mounts = [
  { prefix: '/vendor/three/', dir: packageDir('three') },
  { prefix: '/vendor/meshoptimizer/', dir: packageDir('meshoptimizer') },
  { prefix: '/benchmark-assets/', dir: ASSETS },
  { prefix: '/mesure/', dir: join(ROOT, 'scripts/mesure') },
  { prefix: '/preuve/', dir: preuveDir },
  { prefix: '/sdk/', dir: join(ROOT, 'dist') },
].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));

const server = await startServer({ port: 0, mounts, captures: new Map() });
const port = server.address().port;
const { chromium } = createRequire(join(LAB, 'package.json'))('playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let resultat;
const erreursPage = [];
try {
  const page = await browser.newPage({ viewport: { width: 1012, height: 1000 } });
  page.on('pageerror', (e) => erreursPage.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') erreursPage.push(m.text().slice(0, 400));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) erreursPage.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  // Les bornes du modèle, lues par le harnais de mesure lui-même : les poses du banc en dépendent,
  // et une seconde lecture décrirait une autre scène.
  const bounds = await page.evaluate(
    async (options) => (await import(`${options.mesureUrl}page.mjs`)).readBounds(options),
    { sdkUrl: SDK_URL, mesureUrl: MESURE_URL, manifestUrl },
  );
  // Trente poses réparties sur toute la trajectoire du banc : la caméra bouge à chaque image.
  const total = 9 * 60;
  const poses = Array.from({ length: POSES }, (_, i) =>
    poseAt(bounds, Math.round((i * (total - 1)) / (POSES - 1))),
  );
  resultat = await page.evaluate(
    async (options) => (await import(`${options.modulesUrl}audit.js`)).auditPoses(options),
    {
      sdkUrl: SDK_URL,
      modulesUrl: MODULES_URL,
      manifestUrl,
      width: 1012,
      height: 1000,
      instances: 12,
      pixelError: 1,
      maxPages: 100000,
      warmup: 8,
      poses,
    },
  );
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify({ ...resultat, images: resultat.images?.slice(-3) }, null, 2));
assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
assert.deepEqual(erreursPage, [], 'la page a signalé des erreurs');
assert.deepEqual(resultat.evenements, [], 'le moteur a signalé un repli ou une erreur');

const t = resultat.total;
assert.equal(resultat.images.length, POSES, 'toutes les poses doivent avoir été auditées');
assert.ok(t.clusters > 0, 'aucune ligne résidente n’a été comparée');
assert.equal(t.violations1, 0, `${t.violations1} rectangles GPU plus étroits que la référence`);
assert.equal(t.violations2, 0, `${t.violations2} boîtes coupées par le plan proche sans drapeau`);
assert.equal(t.violations3, 0, `${t.violations3} profondeurs GPU au-dessus de la référence`);
// Preuve d'activité : la coupe tourne bien sur la carte, et l'image n'a pas de trou.
for (const image of resultat.images) {
  assert.equal(image.cpuSelectMs, null, 'la coupe est retombée sur le processeur');
  assert.equal(image.gpuSelectionFallback, false, 'la sélection GPU a été abandonnée');
  assert.equal(image.uncoveredTriangles, 0, 'l’image a un trou');
}
// Sans rejet d'occultation, la conservativité ne prouverait rien : le test doit trancher.
assert.ok(
  resultat.images.some((image) => (image.hizRejectedClusters ?? 0) > 0),
  'le test Hi-Z n’a rejeté aucun cluster : la preuve ne porterait sur rien',
);
// Les grappes transparentes passent le MÊME test, sur la même pyramide : chacune que la carte a
// retirée doit rester rejetée par la référence, sur ses bornes en double précision.
const occ = resultat.occultation;
assert.deepEqual(
  resultat.violationsOccultation,
  [],
  'des grappes transparentes retirées restent visibles pour la référence',
);
assert.ok(occ.examinees > 0, 'aucune grappe transparente n’a été examinée');
assert.ok(
  occ.rejetees > 0,
  'le test d’occultation des transparents n’a rien rejeté : rien à prouver',
);
assert.equal(occ.violations, 0, `${occ.violations} grappes transparentes rejetées à tort`);
const pourcent = (n) => ((100 * n) / t.margeTexelsCount).toFixed(2);
console.log(
  `OK : ${t.clusters} clusters audités sur ${POSES} poses — 0 violation sur les trois règles.\n` +
    `  Rectangle : ${pourcent(t.margeParPalier[0])} % des côtés identiques à la référence, ` +
    `${pourcent(t.margeParPalier[1])} % à un texel près, ${pourcent(t.margeParPalier[4])} % au-delà ` +
    `de seize ; moyenne ${t.margeTexelsMoyenne?.toFixed(3)} texel, max ${t.margeTexelsMax}.\n` +
    `  Profondeur : écart moyen ${t.ecartProfondeurMoyen?.toExponential(3)}, ` +
    `max ${t.ecartProfondeurMax.toExponential(3)}, toujours sous la référence.\n` +
    `  Largeur écran < 16 texels : ${t.largeurParPalier[0]} boîtes côté carte, ` +
    `${t.largeurRefParPalier[0]} côté référence — le test garde la même finesse.`,
);
console.log(
  `OK : ${occ.rejetees} grappes transparentes retirées sur ${occ.examinees} examinées ` +
    `(${occ.poses} poses) — 0 violation : la référence les rejette toutes, ` +
    `dont ${occ.horsEcran} dont le rectangle de référence ne touche aucun pixel.`,
);
