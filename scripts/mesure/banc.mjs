#!/usr/bin/env node
// =====================================================================================
// Banc de mesure commun à tous les lots. Une commande, aucun serveur à lancer à la main :
//
//   node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
//        --vues generale,sol,rue --images 300 --pixelError 0,1 --max-pages 100000
//
// `--moteur` vaut `webgl` (exact-cluster-pages) ou `webgpu` (webgpu-page-raster) ; le moteur
// choisit aussi les drapeaux de Chromium, copiés de `render-tech-lab/scripts/headless/`.
// `--avant` et `--apres` prennent un dossier `dist/` construit ou une référence git, extraite hors
// du dépôt puis construite ; sans `--avant`, un seul côté est mesuré, et `--apres` vaut le `dist/`
// de ce dépôt, construit s'il manque. `--vues` parmi generale, sol, rue, detail. `--pixelError`
// accepte une liste. Autres options : --chauffe N --largeur N --hauteur N --port N (un port libre
// par défaut, jamais 5174) --out <dossier> (par défaut `.mesure/out/<moteur>-<horodatage>/`).
//
// Le harnais écrit `mesure.json`, `resume.md` et un PNG par vue, par seuil et par côté, plus la
// capture du témoin A/A. Un champ vaut `null` quand il n'a pas été mesuré : rien n'est déduit.
// Tout ce qu'il lance — serveur statique, Chromium — il l'arrête, y compris sur erreur.
//
// AUCUN CHRONOMÉTRAGE SÉRIEUX N'EST PROMIS ICI : le harnais relève les durées et la charge de la
// machine au début et à la fin de chaque série. C'est à l'appelant de juger si elle était calme.
// =====================================================================================
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as options from './options.mjs';
import { startServer } from './serveur.mjs';
import { readBounds } from './page.mjs';
import { imageDiff, resume } from './rapport.mjs';
import { runSerie } from './serie.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const { settings, views, out: OUT, flags } = options.readOptions(process.argv.slice(2), ROOT);
const ENGINE = options.ENGINES[settings.engine];
const MANIFEST = `/benchmark-assets/${options.SCENE}-derived/native/full/manifest.json`;
const CTX = { ENGINE, MANIFEST, OUT, settings };

async function main() {
  options.checkLabPath();
  if (!existsSync(join(options.ASSETS, `${options.SCENE}-derived/native/full/manifest.json`)))
    throw new Error(`cache Emerald absent : ${join(options.ASSETS, options.SCENE + '-derived')}`);
  if (!existsSync(options.CHROME)) throw new Error(`Chrome absent : ${options.CHROME}`);
  await mkdir(OUT, { recursive: true });
  const sides = options.resolveSides({
    apres: flags.get('apres'),
    avant: flags.get('avant'),
    root: ROOT,
  });
  const captures = new Map();
  const mounts = [
    { prefix: '/vendor/three/', dir: join(ROOT, 'node_modules/three') },
    { prefix: '/vendor/meshoptimizer/', dir: join(ROOT, 'node_modules/meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: options.ASSETS },
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));

  const report = {
    startedAt: new Date().toISOString(),
    commande: `node scripts/mesure/banc.mjs ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scene: options.SCENE,
    engine: settings.engine,
    engineId: ENGINE.id,
    pathVersion: options.PATH_VERSION,
    settings,
    flags: ENGINE.flags,
    sides: Object.fromEntries(sides.map((s) => [s.name, { dist: s.dist, from: s.from }])),
    series: [],
    errors: [],
  };

  const server = await startServer({ port: settings.port, mounts, captures });
  const port = server.address().port;
  report.settings = { ...settings, port };
  const { chromium } = createRequire(join(options.LAB, 'package.json'))('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: options.CHROME,
    args: ENGINE.flags,
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
    for (const pixelError of settings.pixelErrors)
      for (const view of views) {
        const pose = options.poseAt(report.bounds, options.VIEWS[view].index);
        const serie = {
          view,
          pixelError,
          segment: options.VIEWS[view].segment,
          index: options.VIEWS[view].index,
          pose,
          sides: {},
        };
        report.series.push(serie);
        const files = {};
        for (const side of sides) {
          const { row, captureFile } = await runSerie(
            CTX,
            page,
            side,
            view,
            pixelError,
            pose,
            captures,
          );
          serie.sides[side.name] = row;
          files[side.name] = captureFile;
        }
        // Témoin A/A : le même côté joué deux fois, comparé à lui-même. Il dit ce que vaut zéro.
        const temoin = await runSerie(CTX, page, sides[0], view, pixelError, pose, captures, '-aa');
        serie.sides[`${sides[0].name}-aa`] = temoin.row;
        serie.temoinAA = imageDiff(
          captures.get(files[sides[0].name]),
          captures.get(temoin.captureFile),
        );
        serie.ecartAvantApres = files.avant
          ? imageDiff(captures.get(files.avant), captures.get(files.apres))
          : null;
        const avant = serie.sides.avant,
          apres = serie.sides.apres;
        serie.coupeIdentique =
          avant && apres ? avant.selection.sha256 === apres.selection.sha256 : null;
      }
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }

  report.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'mesure.json'), JSON.stringify(report, null, 1));
  await writeFile(join(OUT, 'resume.md'), resume(report));
  process.stdout.write(
    `\nJSON : ${join(OUT, 'mesure.json')}\nRésumé : ${join(OUT, 'resume.md')}\n`,
  );
  if (report.errors.length) {
    process.stdout.write(`${report.errors.length} erreur(s) de page consignées dans le JSON\n`);
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exitCode = 1;
});
