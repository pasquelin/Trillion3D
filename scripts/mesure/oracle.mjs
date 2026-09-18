#!/usr/bin/env node
// =====================================================================================
// Campagne d'oracle du rebond : l'irradiance indirecte du moteur, convergée, face au traceur de
// chemins du compilateur. Une commande, aucun serveur à lancer à la main :
//
//   node scripts/mesure/oracle.mjs --cache .mesure/cache-piece --source piece/piece.gltf \
//        --ressources piece --largeur 160 --hauteur 120 --lampes 1 --samples 256 --visible
//
// Le moteur et l'oracle reçoivent la même pose, les mêmes lampes et la même taille. Le moteur rend
// la vue `bounce` — l'irradiance indirecte nue, multipliée par l'exposition, sans ACES ni sRGB ;
// l'oracle calcule la même grandeur sur les triangles sources. Le rapport publie l'écart moyen et
// le p95 en pourcentage de l'oracle, la part écrêtée par les huit bits de la capture, et le retard
// de convergence après le déplacement d'une lampe, en images puis en millisecondes.
//
// AUCUN CHRONOMÉTRAGE N'EST PROMIS ICI : c'est une mesure de fidélité, pas de vitesse.
// =====================================================================================
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { lancerChrome } from './chrome.mjs';
import * as options from './options.mjs';
import { startServer, pngFromRgba } from './serveur.mjs';
import { readBounds } from './page.mjs';
import { measureIrradiance } from './oraclePage.mjs';
import { benchLights } from './lampes.mjs';
import {
  compareIrradiance,
  convergenceDelay,
  oracleBuilt,
  oracleJob,
  runOracle,
} from './oracleCompare.mjs';
import { machineLoad } from './rapport.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
// Le même lecteur de drapeaux que le banc : `--nom valeur`, `--nom=valeur`, `--nom` seul.
const flags = options.parseArgs(args);
const flag = (name, fallback) => flags.get(name) ?? fallback;
const number = (name, fallback) => Number(flag(name, fallback));

/** Trois nombres séparés par des virgules, ou rien. Sert aux poses données à la main. */
const triple = (name) => {
  const value = flag(name);
  if (!value || value === 'true') return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)))
    throw new Error(`--${name} attend trois nombres séparés par des virgules`);
  return parts;
};

/** Le déplacement de la lampe qui sert à mesurer le retard : un pas franc, pas un frémissement. */
const MOVED = (position, step) => [position[0] + step, position[1], position[2] + step];

async function main() {
  const cache = options.resolveCache(flag('cache'));
  if (!cache) throw new Error('--cache est requis : le dossier derived du cache compilé');
  const source = resolve(flag('source', ''));
  if (!existsSync(source)) throw new Error(`--source introuvable : ${source}`);
  if (!oracleBuilt(ROOT)) throw new Error('oracle absent : lance `pnpm run build:native`');
  const out = resolve(flag('out', join(ROOT, `.mesure/out/oracle-${Date.now()}`)));
  await mkdir(out, { recursive: true });
  const settings = {
    width: number('largeur', 160),
    height: number('hauteur', 120),
    samples: number('samples', 256),
    bounces: number('bounces', 2),
    exposure: number('exposition', 0.2),
    converge: number('converge', 24),
    delayFrames: number('images-retard', 40),
    delayMargin: number('marge-retard', 1.2),
    floor: number('plancher', 0.01),
    cadenceHz: number('cadence', 60),
    lamps: number('lampes', 1),
    // Même règle générique que le banc : l'intensité des ponctuelles est une option de mesure.
    intensity: number('intensite', 40),
    shadows: flag('ombres', 'on') === 'on',
    pixelError: number('pixelError', 0),
    maxPages: number('max-pages', 100000),
    source,
  };
  const sides = options.resolveSides({ apres: flag('apres'), root: ROOT });
  const side = sides[0];
  side.cache = cache;
  side.manifestUrl = `/cache/${side.name}/native/full/manifest.json`;
  const resources = flag('ressources');
  const mounts = options.resolveMounts(ROOT, sides, resources && resolve(resources));
  const captures = new Map();
  const server = await startServer({ port: 0, mounts, captures });
  const port = server.address().port;
  const browser = await lancerChrome({
    headless: flag('visible', 'false') !== 'true',
    args: options.ENGINES.webgpu.flags,
  });
  const report = {
    startedAt: new Date().toISOString(),
    commande: `node scripts/mesure/oracle.mjs ${args.join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    settings,
    charge: { avant: machineLoad() },
    vues: [],
  };
  try {
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    });
    page.on('pageerror', (error) => report.vues.push({ erreur: String(error) }));
    // Un nuanceur refusé n'arrive pas par `pageerror` : il part en avertissement de console, et la
    // mesure meurt plus loin sur un appareil perdu. On le remonte tel quel.
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        console.error('[page]', m.type(), m.text().slice(0, 600));
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    const bounds = await page.evaluate(readBounds, {
      sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
      manifestUrl: side.manifestUrl,
    });
    const lights = benchLights(bounds, {
      lights: settings.lamps,
      lightShadows: settings.shadows,
      lightIntensity: settings.intensity,
      sun: false,
      movingLight: false,
    });
    const moving = lights && lights.lights.find((light) => light.kind === 'point');
    if (!lights || !moving) throw new Error('--lampes doit déclarer au moins une ponctuelle');
    // Le pas de la lampe : assez franc pour que le rebond ait vraiment à reconverger, sinon le
    // retard mesuré ne mesure rien. Un quart de l'emprise, ou la valeur donnée à la main.
    const step = number('pas', Math.max(1, (bounds.max.x - bounds.min.x) * 0.25));
    const camera = triple('pose'),
      target = triple('cible');
    for (const view of flag('vues', 'generale').split(',')) {
      // Une pose donnée à la main l'emporte sur la trajectoire du banc : une pièce fermée n'a
      // aucune vue utile depuis le dehors, et la trajectoire est faite pour un modèle urbain.
      const known = options.VIEWS[view];
      if (!known && !camera) throw new Error(`vue inconnue : ${view}`);
      const pose = camera
        ? { ...options.poseAt(bounds, 0), position: camera, target: target ?? [0, 0, 0] }
        : options.poseAt(bounds, known.index);
      report.vues.push(
        await runView(page, { side, settings, pose, view, lights, moving, step, out, captures }),
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
  report.charge.apres = machineLoad();
  await writeFile(join(out, 'oracle.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  if (report.vues.some((view) => view.erreur)) process.exitCode = 1;
}

/** Une vue : l'image convergée du moteur, celle de l'oracle, leur écart et le retard mesuré. */
async function runView(page, ctx) {
  const { side, settings, pose, view, lights, moving, step, out, captures } = ctx;
  const captureFile = `${view}-irradiance.png`;
  const result = await page.evaluate(measureIrradiance, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: side.manifestUrl,
    backend: options.ENGINES.webgpu.backend,
    pose,
    captureFile,
    width: settings.width,
    height: settings.height,
    pixelError: settings.pixelError,
    maxPages: settings.maxPages,
    exposure: settings.exposure,
    converge: settings.converge,
    delayFrames: settings.delayFrames,
    lights: lights.lights,
    movingLight: moving.id,
    originalPosition: moving.position,
    movedPosition: MOVED(moving.position, step),
  });
  if (result.erreur) return { vue: view, erreur: result.erreur };
  const capture = captures.get(captureFile);
  if (capture)
    await writeFile(join(out, captureFile), pngFromRgba(capture.body, capture.w, capture.h));
  const reference = join(out, `${view}.f32`);
  const job = oracleJob(settings, pose, lights.lights, reference);
  const oracle = runOracle(ROOT, job, out, view);
  return {
    vue: view,
    pose,
    lampes: lights.lights.length,
    rebond: result.rebond,
    oracle,
    ecart: capture
      ? compareIrradiance(capture, reference, settings.exposure, settings.floor)
      : { erreur: 'capture absente' },
    retard: convergenceDelay(result.gaps, settings),
  };
}

await main();
