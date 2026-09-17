#!/usr/bin/env node
// Compile `packages/page-codec-wasm` pour `wasm32-unknown-unknown` et dépose le module à côté de son
// chargeur, dans `packages/sdk-browser/`. Hors de `pnpm run validate` : la cible et l'archiveur LLVM
// sont une installation locale (`rustup target add wasm32-unknown-unknown`, `rustup component add
// llvm-tools`), et une machine qui ne les a pas doit quand même pouvoir valider le dépôt. Le test
// doré du décodeur, lui, tourne en natif dans `pnpm run test:native`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTE = join(RACINE, 'packages', 'page-codec-wasm', 'Cargo.toml');
const CIBLE = 'wasm32-unknown-unknown';
const SORTIES = [join(RACINE, 'packages', 'sdk-browser'), join(RACINE, 'dist', 'sdk-browser')];
const NOM = 'pageCodec.wasm';

function rustc(...args) {
  return execFileSync('rustc', args, { encoding: 'utf8' }).trim();
}

/**
 * `-relaxed-simd` : les noyaux de calcul en lot du socle (`packages/page-codec-wasm/src/math.rs`)
 * rendent les bits de la version JavaScript parce que WebAssembly n'a AUCUNE instruction de
 * multiplication-addition fusionnée — ni le jeu de base, ni `simd128`. `relaxed-simd` en a une
 * (`f64x2.relaxed_madd`), dont l'arrondi est laissé au moteur : une seule de ces instructions
 * casserait l'égalité, sans rien signaler. Elle n'est pas dans les capacités par défaut de la cible,
 * mais on la refuse explicitement plutôt que d'en dépendre, et `verifieJeuInstructions` relit le
 * module produit pour le confirmer.
 *
 * `simd128` : le décodeur meshopt embarqué a des chemins vectoriels sous `__wasm_simd128__`, et le
 * décodeur JavaScript de référence tourne déjà sur le module SIMD de `meshoptimizer`. Sans ces
 * drapeaux, le module rend les mêmes octets mais perd la moitié de son avance. Un navigateur sans
 * SIMD ne l'instancie pas : le chargeur repasse alors tout seul sur le décodeur JavaScript.
 */

/**
 * La section personnalisée `target_features` du module nomme en clair chaque capacité que le
 * compilateur a autorisée. On y exige `simd128` et on y refuse toute capacité « relaxed », dont les
 * instructions ont un arrondi laissé au moteur.
 */
export function verifieJeuInstructions(chemin) {
  const module = new WebAssembly.Module(readFileSync(chemin));
  const [section] = WebAssembly.Module.customSections(module, 'target_features');
  if (!section) throw new Error(`${chemin} : section « target_features » absente.`);
  const noms = Buffer.from(section).toString('latin1');
  if (noms.includes('relaxed'))
    throw new Error(`${chemin} : capacité « relaxed » présente, arrondi flottant non garanti.`);
  if (!noms.includes('simd128')) throw new Error(`${chemin} : simd128 absent du module produit.`);
}

/**
 * `ar` d'Apple ne sait pas archiver des objets WebAssembly : il rend une archive vide et le lien
 * échoue sur des symboles meshopt absents. `llvm-ar` du composant `llvm-tools` les archive.
 */
function archiveur() {
  const hote = rustc('-vV')
    .split('\n')
    .find((ligne) => ligne.startsWith('host: '))
    ?.slice(6);
  const chemin = join(rustc('--print', 'sysroot'), 'lib', 'rustlib', hote ?? '', 'bin', 'llvm-ar');
  if (!existsSync(chemin))
    throw new Error(
      `llvm-ar introuvable : ${chemin}\nInstaller avec : rustup component add llvm-tools`,
    );
  return chemin;
}

/** Compile le module, le vérifie et le dépose à côté de son chargeur. Rien ici n'est importable
 * sans lancer `cargo build` : c'est pourquoi ce script n'exécute `main()` que joué en CLI, jamais
 * quand `verifieJeuInstructions` est importé pour un test.
 */
function main() {
  /** La bibliothèque standard de la cible est là ou elle n'y est pas : le sysroot le dit. */
  if (!existsSync(join(rustc('--print', 'sysroot'), 'lib', 'rustlib', CIBLE)))
    throw new Error(`Cible ${CIBLE} absente.\nInstaller avec : rustup target add ${CIBLE}`);

  const DRAPEAUX = {
    AR_wasm32_unknown_unknown: archiveur(),
    CFLAGS_wasm32_unknown_unknown: '-msimd128',
    RUSTFLAGS: '-C target-feature=+simd128,-relaxed-simd',
  };

  execFileSync(
    'cargo',
    ['build', '--release', '--locked', '--target', CIBLE, '--manifest-path', MANIFESTE],
    { stdio: 'inherit', env: { ...process.env, ...DRAPEAUX } },
  );

  const construit = join(
    dirname(MANIFESTE),
    'target',
    CIBLE,
    'release',
    'web_geometry_page_codec.wasm',
  );
  verifieJeuInstructions(construit);
  for (const dossier of SORTIES) {
    if (dossier.includes('dist') && !existsSync(dossier)) continue;
    mkdirSync(dossier, { recursive: true });
    copyFileSync(construit, join(dossier, NOM));
  }
  console.log(`${NOM} : ${statSync(construit).size} octets`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
