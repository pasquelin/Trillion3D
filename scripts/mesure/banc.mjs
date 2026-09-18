#!/usr/bin/env node
// =====================================================================================
// Banc de mesure commun à tous les lots. Une commande, aucun serveur à lancer à la main :
//
//   node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
//        --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000
//
// `--moteur` vaut `webgl`, `webgpu` ou `webgl2` ; `--moteur-avant` et `--moteur-apres` le
// redéfinissent côté par côté, ce qui met un moteur face au témoin Three dans une seule exécution,
// mêmes poses, mêmes lampes et même cache. Toutes les options sont décrites dans `README.md`.
//
// Le harnais écrit `mesure.json`, `resume.md` et un PNG par vue, par seuil et par côté, plus la
// capture du témoin A/A. Un champ vaut `null` quand il n'a pas été mesuré : rien n'est déduit.
// Chaque série est jouée dans une page neuve : le contexte WebGL et le tas de la précédente sont
// rendus au navigateur avant que la suivante n'en demande un.
// Tout ce qu'il lance — serveur statique, Chromium — il l'arrête, y compris sur erreur.
//
// AUCUN CHRONOMÉTRAGE SÉRIEUX N'EST PROMIS ICI : le harnais relève les durées et la charge de la
// machine au début et à la fin de chaque série. C'est à l'appelant de juger si elle était calme.
// =====================================================================================
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { lancerChrome } from './chrome.mjs';
import * as options from './options.mjs';
import { startServer } from './serveur.mjs';
import { readBounds } from './page.mjs';
import { imageDiff, resume } from './rapport.mjs';
import { benchLights } from './lampes.mjs';
import { runSerie } from './serie.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const {
  settings,
  views,
  out: OUT,
  flags,
  resources,
} = options.readOptions(process.argv.slice(2), ROOT);
const CTX = { MANIFEST: null, OUT, settings, lights: null, poses: null };

async function main() {
  await mkdir(OUT, { recursive: true });
  const sides = options.resolveSides({
    apres: flags.get('apres'),
    avant: flags.get('avant'),
    root: ROOT,
  });
  // Chaque côté a son cache compilé (`--cache-<côté>`, sinon celui des assets du banc), son moteur
  // (`--moteur-<côté>`, les drapeaux de Chromium étant la réunion) et sa variante (`--variante-<côté>`).
  for (const side of sides) options.equipSide(side, flags, settings);
  const FLAGS = [...new Set(sides.flatMap((side) => side.engine.flags))];
  // La scène mesurée est celle des caches nommés ; sans aucun, la scène de référence du banc.
  const scene = options.sceneOf(sides.find((side) => side.cache)?.cache);
  const MANIFEST = options.assetsManifest(
    scene,
    sides.some((side) => !side.cache),
  );
  CTX.MANIFEST = MANIFEST;
  for (const side of sides) {
    side.manifestUrl = side.cache ? `/cache/${side.name}/native/full/manifest.json` : MANIFEST;
    side.sourceUrl = side.engine.source === 'gltf' ? options.sceneGltf(scene) : null;
  }
  const captures = new Map();
  const mounts = options.resolveMounts(ROOT, sides, resources);

  const report = {
    startedAt: new Date().toISOString(),
    commande: `node scripts/mesure/banc.mjs ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scene,
    engine: settings.engine,
    pathVersion: options.PATH_VERSION,
    settings,
    flags: FLAGS,
    ressources: resources,
    sides: Object.fromEntries(sides.map(options.sideReport)),
    series: [],
    errors: [],
  };

  const server = await startServer({
    port: settings.port,
    mounts,
    captures,
    isolation: settings.isolation,
  });
  const port = server.address().port;
  report.settings = { ...settings, port };
  // Un navigateur neuf par série, fermé aussitôt après. Une scène Emerald laisse plusieurs
  // centaines de mégaoctets dans le processus GPU de Chromium ; fermer seulement la page ne les
  // rend pas, et la troisième série n'obtient plus de contexte (« WebGL2 unavailable »). Relancer
  // le navigateur libère le processus GPU entre deux séries.
  const onFreshPage = async (run) => {
    const browser = await lancerChrome({ headless: !settings.visible, args: FLAGS });
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
    try {
      return await run(page);
    } finally {
      await page.close();
      await browser.close();
    }
  };
  try {
    report.bounds = await onFreshPage((page) =>
      page.evaluate(readBounds, {
        sdkUrl: `/sdk/${sides[0].name}/sdk-browser/index.js`,
        manifestUrl: sides[0].manifestUrl,
      }),
    );
    // Les lampes, une fois les bornes connues : une règle géométrique, aucune scène nommée.
    CTX.lights = benchLights(report.bounds, settings);
    report.lampes = CTX.lights ? CTX.lights.resume : null;
    for (const pixelError of settings.pixelErrors)
      for (const view of views) {
        const index = options.VIEWS[view].index;
        const pose = options.poseAt(report.bounds, index);
        // Caméra en mouvement : une pose par image mesurée, prise sur la trajectoire du banc.
        CTX.poses = settings.movingCamera
          ? Array.from({ length: settings.frames }, (_, i) =>
              options.poseAt(report.bounds, index + i),
            )
          : null;
        const serie = {
          view,
          pixelError,
          segment: options.VIEWS[view].segment,
          index,
          pose,
          sides: {},
        };
        report.series.push(serie);
        const files = {};
        for (const side of sides) {
          const { row, captureFile } = await onFreshPage((page) =>
            runSerie(CTX, page, side, view, pixelError, pose, captures),
          );
          serie.sides[side.name] = row;
          files[side.name] = captureFile;
        }
        // Témoin A/A : le même côté joué deux fois, comparé à lui-même. Il dit ce que vaut zéro.
        const temoin = await onFreshPage((page) =>
          runSerie(CTX, page, sides[0], view, pixelError, pose, captures, '-aa'),
        );
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
