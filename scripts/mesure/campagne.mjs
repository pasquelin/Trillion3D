#!/usr/bin/env node
// =====================================================================================
// The complete benchmark campaign: everything the benchmark can measure, run in a single command,
// each reference scene (`emerald-square`, `whisperwind-village`) then each run under
// `--out/<scene>/<name>/` (default `.mesure/out/global/`). A run whose directory already
// contains a `mesure.json` is skipped to resume an interrupted campaign.
//
//   node scripts/mesure/campagne.mjs [--out .mesure/out/global] [--scene a,b] [--seulement name,name] [--liste]
//
// Each line names what it isolates: a single option distinguishes it from its neighbor, and it is
// this difference that is read in `rapportGlobal.mjs`. Resolutions, camera, sun, and baked textures
// are those of the backlog measurements so numbers remain comparable.
// =====================================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, scenesOf } from './options.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
// Argument groups that lines name in one word, replaced at execution.
const GROUPES = {
  PLEINE: '--largeur 2496 --hauteur 1404',
  QUART: '--largeur 1248 --hauteur 702',
  TOUTES: '--vues generale,sol,rue,detail',
  DEUX: '--vues generale,sol',
  MOBILE: '--soleil --camera-mobile',
  // Two sides on the same dist: the first carries the variant or engine making the difference.
  DEUX_COTES: '--avant dist --apres dist',
  NU: '--moteur-avant three-nu --moteur-apres webgpu --avant dist --apres dist',
  LOD: '--moteur-avant three-lod --moteur-apres webgpu --avant dist --apres dist',
};
const SOCLE = '--moteur webgpu --images 60 --textures cache';

// One line per execution: `name | what it isolates | arguments`, uppercase groups.
const LIGNES = `
fixe | held frame: locked camera, no GPU work expected | TOUTES --pixelError 0,1,2 --soleil PLEINE
mobile | campaign baseline: moving camera, sun, four views, two thresholds | TOUTES --pixelError 0,1 MOBILE PLEINE
sans-lumiere | raw albedo: lighting cost by difference with \`mobile\` | TOUTES --pixelError 1 --camera-mobile PLEINE
soleil-sans-ombres | sun without shadow maps: cascade cost by difference with \`mobile\` | DEUX --pixelError 1 MOBILE PLEINE --ombres off
res-1872 | 1872×1053 resolution | DEUX --pixelError 1 MOBILE --largeur 1872 --hauteur 1053
res-1248 | 1248×702 resolution | DEUX --pixelError 1 MOBILE QUART
res-624 | 624×351 resolution | DEUX --pixelError 1 MOBILE --largeur 624 --hauteur 351
res-1248-e0 | 1248×702 at threshold 0: triangles per pixel | DEUX --pixelError 0 MOBILE QUART
res-1248-e2 | 1248×702 at threshold 2 | DEUX --pixelError 2 MOBILE QUART
raster-1248 | compute raster (before, variant) vs hardware raster (after, default) at 1248×702 | DEUX_COTES --variante-avant raster-calcul DEUX --pixelError 1 MOBILE QUART
raster-2496 | compute raster vs hardware raster at 2496×1404 | DEUX_COTES --variante-avant raster-calcul DEUX --pixelError 1 MOBILE PLEINE
aa-off | no temporal antialiasing: accumulation cost and pixels by difference with \`mobile\` | DEUX --pixelError 1 MOBILE PLEINE --antialiasing off
profil-off | no per-step profile: profile cost and fidelity gate | DEUX --pixelError 1 MOBILE PLEINE --profil off
textures-host | textures from source images, not the cooked pyramid | DEUX --pixelError 1 MOBILE PLEINE --textures host
isolation | isolated page across origins: shared-memory path | DEUX --pixelError 1 MOBILE PLEINE --isolation on
math-js | batched math forced to JavaScript | DEUX --pixelError 1 MOBILE PLEINE --chemin-math js
math-wasm | batched math forced to WebAssembly | DEUX --pixelError 1 MOBILE PLEINE --chemin-math wasm
lampes-4 | four point lights with shadows, plus the sun | DEUX --pixelError 1 MOBILE PLEINE --lampes 4
lampes-4-sans-ombres | four point lights and sun with no shadows: map cost by difference | DEUX --pixelError 1 MOBILE PLEINE --lampes 4 --ombres off
lampes-16 | sixteen point lights with shadows | DEUX --pixelError 1 MOBILE PLEINE --lampes 16
lampe-mobile | locked camera, one moving light: cost of a shadow that redraws | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --empreinte-ombres PLEINE
ombres-pages-off | same, full shadow face: atlas identity gate | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --empreinte-ombres --ombres-pages off PLEINE
budget-ombres-0-25 | shadow budget clamped to 0.25 ms: pending pages and lag | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --budget-ombres 0.25 PLEINE
rebond | bounce lighting on | DEUX --pixelError 1 MOBILE PLEINE --lampes 4 --rebond on
instances-4 | four copies of the model | --vues generale --pixelError 1 MOBILE PLEINE --instances 4
instances-12 | twelve copies of the model | --vues generale --pixelError 1 MOBILE PLEINE --instances 12
pool-geo-8 | 8 MiB geometry pool: residency under extreme pressure, full image expected | TOUTES --pixelError 1 MOBILE PLEINE --pool-geometrie 8
pool-tex-64 | 64 MiB texture pool: one layer per atlas, coarse levels expected | TOUTES --pixelError 1 MOBILE PLEINE --pool-textures 64
pool-4k | 3840×2160: targets follow resolution, no cap refuses | DEUX --pixelError 1 MOBILE --largeur 3840 --hauteur 2160
temoin-three | SDK Three witness (before) vs WebGPU engine (after), no shadows | --moteur-avant webgl --moteur-apres webgpu DEUX_COTES DEUX --pixelError 1 --soleil --ombres off PLEINE
webgl | WebGL engine (exact-cluster-pages) | --moteur webgl TOUTES --pixelError 1 MOBILE PLEINE
webgl2 | standalone WebGL2 engine (refusal expected if the cache carries blend) | --moteur webgl2 DEUX --pixelError 1 MOBILE PLEINE
three-nu | Three vanilla (before) vs WebGPU engine (after), sun and shadows, moving camera | NU TOUTES --pixelError 1 MOBILE PLEINE
three-nu-1248 | Three vanilla vs the engine at 1248×702 | NU DEUX --pixelError 1 MOBILE QUART
three-nu-sans-ombres | Three vanilla vs the engine without shadows: materials and lighting fidelity | NU DEUX --pixelError 1 --soleil --ombres off PLEINE
three-nu-lampes-4 | Three vanilla vs the engine, sun and four shadowed point lights | NU DEUX --pixelError 1 MOBILE PLEINE --lampes 4
three-lod | Three with three LOD levels (before) vs WebGPU engine (after), sun and shadows, moving camera | LOD TOUTES --pixelError 1 MOBILE PLEINE
three-lod-1248 | Three LOD vs the engine at 1248×702 | LOD DEUX --pixelError 1 MOBILE QUART
three-lod-sans-ombres | Three LOD vs the engine without shadows | LOD DEUX --pixelError 1 --soleil --ombres off PLEINE
three-lod-lampes-4 | Three LOD vs the engine, sun and four shadowed point lights | LOD DEUX --pixelError 1 MOBILE PLEINE --lampes 4
visible | window open: cadence not capped at 60 Hz | DEUX --pixelError 1 MOBILE PLEINE --visible
`;

/** Words in an argument line, groups replaced. */
const mots = (texte) =>
  texte
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((mot) => (GROUPES[mot] ? GROUPES[mot].split(' ') : [mot]));

/** Executions in order: `[name, why, arguments beyond base]`. */
export const CAMPAGNE = LIGNES.trim()
  .split('\n')
  .map((ligne) => ligne.split('|').map((champ) => champ.trim()))
  .map(([nom, pourquoi, args]) => [nom, pourquoi, mots(args)]);

function run(name, args, out, log, scene) {
  const dir = join(out, scene, name);
  if (existsSync(join(dir, 'mesure.json'))) return 'already measured';
  mkdirSync(dir, { recursive: true });
  const argv = [
    'scripts/mesure/banc.mjs',
    ...SOCLE.split(' '),
    '--scene',
    scene,
    ...args,
    '--out',
    dir,
  ];
  const started = Date.now();
  const result = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  appendFileSync(join(dir, 'campagne.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const status = result.status === 0 ? 'ok' : `failed (${result.status})`;
  appendFileSync(
    log,
    `${new Date().toISOString()} ${scene}/${name} ${status} ${((Date.now() - started) / 1000).toFixed(0)} s\n`,
  );
  return status;
}

if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  const out = resolve(flags.get('out') ?? join(ROOT, '.mesure/out/global'));
  const only = flags.get('seulement')?.split(',').filter(Boolean);
  const chosen = CAMPAGNE.filter(([name]) => !only || only.includes(name));
  const scenes = scenesOf(flags);
  if (flags.has('liste')) {
    for (const scene of scenes)
      for (const [name, why] of chosen) console.log(`${`${scene}/${name}`.padEnd(36)} ${why}`);
    process.exit(0);
  }
  mkdirSync(out, { recursive: true });
  const log = join(out, 'campagne.log');
  for (const scene of scenes)
    for (const [name, why, args] of chosen) {
      console.log(`▶ ${scene}/${name} — ${why}`);
      console.log(`  ${run(name, args, out, log, scene)}`);
    }
}
