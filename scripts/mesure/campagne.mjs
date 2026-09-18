#!/usr/bin/env node
// =====================================================================================
// La campagne complète : tout ce que le banc sait mesurer, joué d'une seule commande, chaque
// exécution dans son dossier sous `--out` (par défaut `.mesure/out/global/`). Une exécution dont le
// dossier porte déjà un `mesure.json` est sautée, pour reprendre une campagne interrompue.
//
//   node scripts/mesure/campagne.mjs [--out .mesure/out/global] [--seulement nom,nom] [--liste]
//
// Chaque ligne nomme ce qu'elle isole : une seule option la distingue de sa voisine, et c'est cette
// différence qui se lit dans `rapportGlobal.mjs`. Les résolutions, la caméra, le soleil et les
// textures cuites sont ceux des relevés du backlog, pour que les chiffres se comparent.
// =====================================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './options.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
// Les groupes d'arguments que les lignes nomment en un mot, remplacés au lancement.
const GROUPES = {
  PLEINE: '--largeur 2496 --hauteur 1404',
  QUART: '--largeur 1248 --hauteur 702',
  TOUTES: '--vues generale,sol,rue,detail',
  DEUX: '--vues generale,sol',
  MOBILE: '--soleil --camera-mobile',
  // Deux côtés sur le même dist : le premier porte la variante ou le moteur qui fait la différence.
  DEUX_COTES: '--avant dist --apres dist',
  NU: '--moteur-avant three-nu --moteur-apres webgpu --avant dist --apres dist',
  LOD: '--moteur-avant three-lod --moteur-apres webgpu --avant dist --apres dist',
};
const SOCLE = '--moteur webgpu --images 60 --textures cache';

// Une ligne par exécution : `nom | ce qu'elle isole | arguments`, groupes en majuscules.
const LIGNES = `
fixe | image tenue : caméra fixe, aucun travail carte attendu | TOUTES --pixelError 0,1,2 --soleil PLEINE
mobile | référence de la campagne : caméra mobile, soleil, quatre vues, deux seuils | TOUTES --pixelError 0,1 MOBILE PLEINE
sans-lumiere | albédo brut : le coût de l’éclairage par différence avec \`mobile\` | TOUTES --pixelError 1 --camera-mobile PLEINE
res-1872 | résolution 1872×1053 | DEUX --pixelError 1 MOBILE --largeur 1872 --hauteur 1053
res-1248 | résolution 1248×702 | DEUX --pixelError 1 MOBILE QUART
res-624 | résolution 624×351 | DEUX --pixelError 1 MOBILE --largeur 624 --hauteur 351
res-1248-e0 | résolution 1248×702 au seuil 0 : densité de triangles par pixel | DEUX --pixelError 0 MOBILE QUART
res-1248-e2 | résolution 1248×702 au seuil 2 | DEUX --pixelError 2 MOBILE QUART
raster-1248 | raster de calcul (avant, variante) contre raster matériel (après, défaut) à 1248×702 | DEUX_COTES --variante-avant raster-calcul DEUX --pixelError 1 MOBILE QUART
raster-2496 | raster de calcul contre raster matériel à 2496×1404 | DEUX_COTES --variante-avant raster-calcul DEUX --pixelError 1 MOBILE PLEINE
aa-off | sans antialiasing temporel : coût et pixels de l’accumulation par différence avec \`mobile\` | DEUX --pixelError 1 MOBILE PLEINE --antialiasing off
profil-off | sans profil par étape : coût du profil et porte de fidélité | DEUX --pixelError 1 MOBILE PLEINE --profil off
textures-host | textures lues depuis les images sources et non la pyramide cuite | DEUX --pixelError 1 MOBILE PLEINE --textures host
isolation | page isolée entre origines : chemin de mémoire partagée | DEUX --pixelError 1 MOBILE PLEINE --isolation on
math-js | calculs en lot forcés en JavaScript | DEUX --pixelError 1 MOBILE PLEINE --chemin-math js
math-wasm | calculs en lot forcés en WebAssembly | DEUX --pixelError 1 MOBILE PLEINE --chemin-math wasm
lampes-4 | quatre ponctuelles avec ombres, plus le soleil | DEUX --pixelError 1 MOBILE PLEINE --lampes 4
lampes-4-sans-ombres | quatre ponctuelles et soleil sans aucune ombre : le coût des cartes par différence | DEUX --pixelError 1 MOBILE PLEINE --lampes 4 --ombres off
lampes-16 | seize ponctuelles avec ombres | DEUX --pixelError 1 MOBILE PLEINE --lampes 16
lampe-mobile | caméra fixe, une lampe qui bouge : ce que coûte une ombre qui se redessine | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --empreinte-ombres PLEINE
ombres-pages-off | même chose, face d’ombre entière : porte d’identité de l’atlas | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --empreinte-ombres --ombres-pages off PLEINE
budget-ombres-0-25 | budget d’ombres serré à 0,25 ms : pages en attente et retard | --vues sol --pixelError 1 --soleil --lampes 4 --lampe-mobile --budget-ombres 0.25 PLEINE
rebond | lumière qui rebondit allumée | DEUX --pixelError 1 MOBILE PLEINE --lampes 4 --rebond on
instances-4 | quatre copies du modèle | --vues generale --pixelError 1 MOBILE PLEINE --instances 4
instances-12 | douze copies du modèle | --vues generale --pixelError 1 MOBILE PLEINE --instances 12
pool-geo-8 | pool de géométrie de 8 Mio : la résidence sous contrainte extrême, image complète attendue | TOUTES --pixelError 1 MOBILE PLEINE --pool-geometrie 8
pool-tex-64 | pool de textures de 64 Mio : une couche par atlas, niveaux grossiers attendus | TOUTES --pixelError 1 MOBILE PLEINE --pool-textures 64
pool-4k | 3840×2160 : les cibles suivent la résolution, plus aucun plafond ne refuse | DEUX --pixelError 1 MOBILE --largeur 3840 --hauteur 2160
temoin-three | le témoin Three du SDK (avant) face au moteur WebGPU (après), sans ombres | --moteur-avant webgl --moteur-apres webgpu DEUX_COTES DEUX --pixelError 1 --soleil --ombres off PLEINE
webgl | le moteur WebGL (exact-cluster-pages) | --moteur webgl TOUTES --pixelError 1 MOBILE PLEINE
webgl2 | le moteur autonome WebGL2 (refus attendu si le cache porte du mélange) | --moteur webgl2 DEUX --pixelError 1 MOBILE PLEINE
three-nu | Three nu (avant) face au moteur WebGPU (après), soleil et ombres, caméra mobile | NU TOUTES --pixelError 1 MOBILE PLEINE
three-nu-1248 | Three nu face au moteur à 1248×702 | NU DEUX --pixelError 1 MOBILE QUART
three-nu-sans-ombres | Three nu face au moteur sans ombres : fidélité des matériaux et de la lumière seule | NU DEUX --pixelError 1 --soleil --ombres off PLEINE
three-nu-lampes-4 | Three nu face au moteur, soleil et quatre ponctuelles avec ombres | NU DEUX --pixelError 1 MOBILE PLEINE --lampes 4
three-lod | Three à trois niveaux de détail (avant) face au moteur WebGPU (après), soleil et ombres, caméra mobile | LOD TOUTES --pixelError 1 MOBILE PLEINE
three-lod-1248 | Three à niveaux de détail face au moteur à 1248×702 | LOD DEUX --pixelError 1 MOBILE QUART
three-lod-sans-ombres | Three à niveaux de détail face au moteur sans ombres | LOD DEUX --pixelError 1 --soleil --ombres off PLEINE
three-lod-lampes-4 | Three à niveaux de détail face au moteur, soleil et quatre ponctuelles avec ombres | LOD DEUX --pixelError 1 MOBILE PLEINE --lampes 4
visible | fenêtre ouverte : cadence non plafonnée à 60 Hz | DEUX --pixelError 1 MOBILE PLEINE --visible
`;

/** Les mots d'une ligne d'arguments, groupes remplacés. */
const mots = (texte) =>
  texte
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((mot) => (GROUPES[mot] ? GROUPES[mot].split(' ') : [mot]));

/** Les exécutions, dans l'ordre : `[nom, pourquoi, arguments au-delà du socle]`. */
export const CAMPAGNE = LIGNES.trim()
  .split('\n')
  .map((ligne) => ligne.split('|').map((champ) => champ.trim()))
  .map(([nom, pourquoi, args]) => [nom, pourquoi, mots(args)]);

function run(name, args, out, log) {
  const dir = join(out, name);
  if (existsSync(join(dir, 'mesure.json'))) return 'déjà mesuré';
  mkdirSync(dir, { recursive: true });
  const argv = ['scripts/mesure/banc.mjs', ...SOCLE.split(' '), ...args, '--out', dir];
  const started = Date.now();
  const result = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  appendFileSync(join(dir, 'campagne.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const status = result.status === 0 ? 'ok' : `échec (${result.status})`;
  appendFileSync(
    log,
    `${new Date().toISOString()} ${name} ${status} ${((Date.now() - started) / 1000).toFixed(0)} s\n`,
  );
  return status;
}

if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  const out = resolve(flags.get('out') ?? join(ROOT, '.mesure/out/global'));
  const only = flags.get('seulement')?.split(',').filter(Boolean);
  const chosen = CAMPAGNE.filter(([name]) => !only || only.includes(name));
  if (flags.has('liste')) {
    for (const [name, why] of chosen) console.log(`${name.padEnd(22)} ${why}`);
    process.exit(0);
  }
  mkdirSync(out, { recursive: true });
  const log = join(out, 'campagne.log');
  for (const [name, why, args] of chosen) {
    console.log(`▶ ${name} — ${why}`);
    console.log(`  ${run(name, args, out, log)}`);
  }
}
