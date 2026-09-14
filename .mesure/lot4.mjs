#!/usr/bin/env node
// =====================================================================================
// Harnais de mesure du lot 4 (R5 WebGL2, sélection de clusters sur CPU).
//
// COMMANDE EXACTE, depuis la racine de ce worktree, aucun serveur à lancer à la main :
//
//   node .mesure/lot4.mjs --avant eab2bfa --images 300
//
// Essai rapide, qui prouve seulement que le harnais produit son JSON et son PNG :
//
//   node .mesure/lot4.mjs --vues generale --images 8
//
// `--avant` prend un dossier `dist/` construit ou une référence git, qu'il extrait et construit
// dans un dossier séparé ; sans lui un seul côté est mesuré. `--apres` vaut le `dist/` de ce
// worktree, construit s'il manque. Autres options : --vues generale,sol,detail --chauffe N
// --pixel-error N (0) --max-pages N (100000) --largeur N --hauteur N --port N (un port libre par défaut, jamais
// 5174) --out <dossier> (par défaut `.mesure/out/<horodatage>/`, où sont écrits `mesure.json`
// — cpuSelectMs p50/p95, hash SHA-256 des ids de clusters triés et métriques par côté et par
// vue, plus le verdict d'identité quand les deux côtés sont là —, `<côté>-<vue>.png` et
// `<côté>-<vue>.clusters.txt`).
//
// Une seule commande, quatre fichiers : `banc.mjs` (trajectoire du banc, dists, statistiques),
// `serveur.mjs` (serveur statique, PNG) et `page.mjs` (ce qui tourne dans le navigateur) sont
// séparés d'ici pour tenir la limite de 200 lignes par fichier source du dépôt. Le serveur du
// harnais est arrêté à la fin, y compris sur erreur ; rien n'est écrit dans render-tech-lab/,
// lu seulement pour ses assets Emerald, son Playwright et la trajectoire du banc.
//
// AUCUN CHRONOMÉTRAGE SÉRIEUX N'EST PROMIS ICI : le harnais relève `cpuSelectMs`, il ne dit pas
// si la machine était calme. C'est à l'appelant de le vérifier avant de conclure.
// =====================================================================================
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as banc from './banc.mjs';
import { pngFromRgba, startServer } from './serveur.mjs';
import { measureView, readBounds } from './page.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

const { flags, settings, OUT } = banc.readOptions(process.argv.slice(2), ROOT);

const MANIFEST = `/benchmark-assets/${banc.SCENE}-derived/native/full/manifest.json`;

/** Mesure une vue pour un côté, écrit sa capture et ses ids, et renvoie sa ligne de rapport. */
async function runSide(page, side, view, pose, captures) {
  const captureFile = `${side.name}-${view}.png`;
  const result = await page.evaluate(measureView, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: MANIFEST,
    pose,
    captureFile,
    ...settings,
  });
  const cpuSelectMs = banc.distribution(result.samples);
  const sha256 = createHash('sha256').update(result.ids.join('\n')).digest('hex');
  await writeFile(join(OUT, `${side.name}-${view}.clusters.txt`), result.ids.join('\n') + '\n');
  const capture = captures.get(captureFile);
  if (capture)
    await writeFile(join(OUT, captureFile), pngFromRgba(capture.body, capture.w, capture.h));
  process.stdout.write(
    `${side.name} ${view} : cpuSelectMs p50=${cpuSelectMs ? cpuSelectMs.p50.toFixed(3) : '—'} ` +
      `p95=${cpuSelectMs ? cpuSelectMs.p95.toFixed(3) : '—'} clusters=${result.ids.length} ` +
      `hash=${sha256.slice(0, 12)} png=${capture ? 'oui' : 'non'}\n`,
  );
  return {
    cpuSelectMs,
    selection: { sha256, clusters: result.ids.length },
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    metrics: result.metrics,
    canvas: result.size,
  };
}

async function main() {
  banc.checkLabPath();
  if (!existsSync(join(banc.ASSETS, `${banc.SCENE}-derived/native/full/manifest.json`)))
    throw new Error(`cache Emerald absent : ${join(banc.ASSETS, banc.SCENE + '-derived')}`);
  if (!existsSync(banc.CHROME)) throw new Error(`Chrome absent : ${banc.CHROME}`);
  await mkdir(OUT, { recursive: true });

  const sides = banc.resolveSides({
    apres: flags.get('apres'),
    avant: flags.get('avant'),
    root: ROOT,
    out: OUT,
  });
  const views = (flags.get('vues') ?? Object.keys(banc.VIEWS).join(',')).split(',').filter(Boolean);
  for (const view of views) if (!banc.VIEWS[view]) throw new Error(`vue inconnue : ${view}`);

  const captures = new Map();
  const mounts = [
    { prefix: '/vendor/three/', dir: join(ROOT, 'node_modules/three') },
    { prefix: '/vendor/meshoptimizer/', dir: join(ROOT, 'node_modules/meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: banc.ASSETS },
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));

  const report = {
    startedAt: new Date().toISOString(),
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scene: banc.SCENE,
    engine: 'exact-cluster-pages',
    pathVersion: banc.PATH_VERSION,
    settings,
    sides: Object.fromEntries(
      sides.map((side) => [side.name, { dist: side.dist, from: side.from }]),
    ),
    views: {},
    errors: [],
  };

  const server = await startServer({ port: settings.port, mounts, captures });
  const port = server.address().port;
  report.settings = { ...settings, port };
  const { chromium } = createRequire(join(banc.LAB, 'package.json'))('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: banc.CHROME,
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    });
    page.on('pageerror', (e) =>
      report.errors.push({ kind: 'pageerror', message: String(e.message) }),
    );
    page.on('response', (r) => {
      if (r.status() >= 400) report.errors.push({ kind: 'http', status: r.status(), url: r.url() });
    });
    page.on('console', (m) => {
      if (m.type() === 'error')
        report.errors.push({ kind: 'console', message: m.text().slice(0, 400) });
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    report.bounds = await page.evaluate(readBounds, {
      sdkUrl: `/sdk/${sides[0].name}/sdk-browser/index.js`,
      manifestUrl: MANIFEST,
    });
    for (const view of views) {
      const pose = banc.poseAt(report.bounds, banc.VIEWS[view].index);
      const entry = {
        segment: banc.VIEWS[view].segment,
        index: banc.VIEWS[view].index,
        pose,
        sides: {},
      };
      report.views[view] = entry;
      for (const side of sides)
        entry.sides[side.name] = await runSide(page, side, view, pose, captures);
      const before = entry.sides.avant,
        after = entry.sides.apres;
      if (before && after)
        entry.identique =
          before.selection.sha256 === after.selection.sha256
            ? 'la coupe sélectionnée est la même, cluster pour cluster'
            : `COUPES DIFFÉRENTES : ${before.selection.clusters} avant, ${after.selection.clusters} après`;
    }
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }

  report.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'mesure.json'), JSON.stringify(report, null, 1));
  process.stdout.write(`\nJSON : ${join(OUT, 'mesure.json')}\n`);
  if (report.errors.length) {
    process.stdout.write(`${report.errors.length} erreur(s) de page consignées dans le JSON\n`);
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exitCode = 1;
});
