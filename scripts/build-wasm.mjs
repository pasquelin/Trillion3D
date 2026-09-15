#!/usr/bin/env node
// Compile `packages/page-codec-wasm` pour `wasm32-unknown-unknown` et dépose le module à côté de son
// chargeur, dans `packages/sdk-browser/`. Hors de `npm run validate` : la cible et l'archiveur LLVM
// sont une installation locale (`rustup target add wasm32-unknown-unknown`, `rustup component add
// llvm-tools`), et une machine qui ne les a pas doit quand même pouvoir valider le dépôt. Le test
// doré du décodeur, lui, tourne en natif dans `npm run test:native`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTE = join(RACINE, 'packages', 'page-codec-wasm', 'Cargo.toml');
const CIBLE = 'wasm32-unknown-unknown';
const SORTIES = [join(RACINE, 'packages', 'sdk-browser'), join(RACINE, 'dist', 'sdk-browser')];
const NOM = 'pageCodec.wasm';

function rustc(...args) {
  return execFileSync('rustc', args, { encoding: 'utf8' }).trim();
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

/** La bibliothèque standard de la cible est là ou elle n'y est pas : le sysroot le dit. */
if (!existsSync(join(rustc('--print', 'sysroot'), 'lib', 'rustlib', CIBLE)))
  throw new Error(`Cible ${CIBLE} absente.\nInstaller avec : rustup target add ${CIBLE}`);

/**
 * `simd128` : le décodeur meshopt embarqué a des chemins vectoriels sous `__wasm_simd128__`, et le
 * décodeur JavaScript de référence tourne déjà sur le module SIMD de `meshoptimizer`. Sans ces
 * drapeaux, le module rend les mêmes octets mais perd la moitié de son avance. Un navigateur sans
 * SIMD ne l'instancie pas : le chargeur repasse alors tout seul sur le décodeur JavaScript.
 */
const DRAPEAUX = {
  AR_wasm32_unknown_unknown: archiveur(),
  CFLAGS_wasm32_unknown_unknown: '-msimd128',
  RUSTFLAGS: '-C target-feature=+simd128',
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
for (const dossier of SORTIES) {
  if (dossier.includes('dist') && !existsSync(dossier)) continue;
  mkdirSync(dossier, { recursive: true });
  copyFileSync(construit, join(dossier, NOM));
}
console.log(`${NOM} : ${statSync(construit).size} octets`);
