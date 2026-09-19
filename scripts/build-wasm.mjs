#!/usr/bin/env node
// Compiles `packages/page-codec-wasm` for `wasm32-unknown-unknown` and deposits the module next to its
// loader, in `packages/sdk-browser/`. Outside of `pnpm run validate`: the target and LLVM archiver
// are a local setup (`rustup target add wasm32-unknown-unknown`, `rustup component add
// llvm-tools`), and a machine without them must still be able to validate the repo. The decoder's
// golden test runs natively in `pnpm run test:native`.
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
 * `-relaxed-simd`: the batch computation kernels of core (`packages/page-codec-wasm/src/math.rs`)
 * match the bitwise output of the JavaScript version because WebAssembly has NO fused multiply-add
 * instruction — neither in base nor `simd128`. `relaxed-simd` has one (`f64x2.relaxed_madd`), whose
 * rounding is implementation-defined: a single such instruction would break exact bit equality silently.
 * It is not enabled by default for the target, but we explicitly reject it rather than depend on it,
 * and `verifieJeuInstructions` re-reads the output module to confirm.
 *
 * `simd128`: the embedded meshopt decoder has vector paths under `__wasm_simd128__`, and the reference
 * JavaScript decoder already runs on the SIMD module of `meshoptimizer`. Without these flags, the module
 * outputs the same bytes but loses half its speedup. A browser without SIMD will fail instantiation,
 * causing the loader to silently fall back to JavaScript decoder.
 */

/**
 * The `target_features` custom section of the module lists each capability authorized by the compiler.
 * We require `simd128` and reject any "relaxed" feature whose instruction rounding is implementation-defined.
 */
export function verifieJeuInstructions(chemin) {
  const module = new WebAssembly.Module(readFileSync(chemin));
  const [section] = WebAssembly.Module.customSections(module, 'target_features');
  if (!section) throw new Error(`${chemin}: "target_features" section missing.`);
  const noms = Buffer.from(section).toString('latin1');
  if (noms.includes('relaxed'))
    throw new Error(
      `${chemin}: "relaxed" capability present, floating-point rounding not guaranteed.`,
    );
  if (!noms.includes('simd128'))
    throw new Error(`${chemin}: simd128 missing from the produced module.`);
}

/**
 * Apple's `ar` cannot archive WebAssembly objects: it produces an empty archive causing link failure
 * on missing meshopt symbols. `llvm-ar` from `llvm-tools` archives them properly.
 */
function archiveur() {
  const hote = rustc('-vV')
    .split('\n')
    .find((ligne) => ligne.startsWith('host: '))
    ?.slice(6);
  const chemin = join(rustc('--print', 'sysroot'), 'lib', 'rustlib', hote ?? '', 'bin', 'llvm-ar');
  if (!existsSync(chemin))
    throw new Error(`llvm-ar not found: ${chemin}\nInstall with: rustup component add llvm-tools`);
  return chemin;
}

/** Compiles the module, verifies it, and places it alongside its loader. Nothing here is importable
 * without running `cargo build`: which is why this script only executes `main()` when invoked via CLI,
 * never when `verifieJeuInstructions` is imported for testing.
 */
function main() {
  /** The target standard library is either present or missing: sysroot indicates it. */
  if (!existsSync(join(rustc('--print', 'sysroot'), 'lib', 'rustlib', CIBLE)))
    throw new Error(`Target ${CIBLE} missing.\nInstall with: rustup target add ${CIBLE}`);

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
  console.log(`${NOM}: ${statSync(construit).size} bytes`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
