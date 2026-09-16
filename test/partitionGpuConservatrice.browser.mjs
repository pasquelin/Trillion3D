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
//     test/partitionGpuConservatrice.browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { startServer } from '../scripts/mesure/serveur.mjs';
import { ASSETS, DEFAULT_SCENE, labManifest } from '../scripts/mesure/scene.mjs';
import { LAB, checkLabPath, poseAt } from '../scripts/mesure/poses.mjs';

const ROOT = resolve(import.meta.dirname, '..');
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
  'dist absent : lancer `npm run build` avant cette preuve',
);
const mounts = [
  { prefix: '/vendor/three/', dir: packageDir('three') },
  { prefix: '/vendor/meshoptimizer/', dir: packageDir('meshoptimizer') },
  { prefix: '/benchmark-assets/', dir: ASSETS },
  { prefix: '/preuve/', dir: join(ROOT, 'test/browserFixtures') },
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
  const bounds = await page.evaluate(
    async (options) =>
      (await import('/preuve/partitionBoundsPage.mjs')).readSceneBounds(options),
    { sdkUrl: '/sdk/sdk-browser/index.js', manifestUrl },
  );
  // Trente poses réparties sur toute la trajectoire du banc : la caméra bouge à chaque image.
  const total = 9 * 60;
  const poses = Array.from({ length: POSES }, (_, i) =>
    poseAt(bounds, Math.round((i * (total - 1)) / (POSES - 1))),
  );
  resultat = await page.evaluate(
    async (options) =>
      (await import('/preuve/partitionConservatricePage.mjs')).auditPoses(options),
    {
      sdkUrl: '/sdk/sdk-browser/index.js',
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
console.log(
  `OK : ${t.clusters} clusters audités sur ${POSES} poses — 0 violation sur les trois règles ; ` +
    `marge rectangle moyenne ${t.margeTexelsMoyenne?.toFixed(4)} texel (max ${t.margeTexelsMax}), ` +
    `marge profondeur moyenne ${t.ecartProfondeurMoyen?.toExponential(3)} ` +
    `(max ${t.ecartProfondeurMax.toExponential(3)})`,
);
