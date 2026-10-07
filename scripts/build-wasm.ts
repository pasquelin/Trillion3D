#!/usr/bin/env node
// Compiles `packages/page-codec-wasm` for `wasm32-unknown-unknown` and deposits the module next to its
// loader, in `packages/sdk-browser/src/wasm/`. Outside of `pnpm run validate`: the target and LLVM archiver
// are a local setup (`rustup target add wasm32-unknown-unknown`, `rustup component add
// llvm-tools`), and a machine without them must still be able to validate the repo. The page decoder's
// golden test runs natively in `pnpm run test:native`.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WASM_CRATE } from './native-crates.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFESTE = join(ROOT, WASM_CRATE.path, 'Cargo.toml')
const CIBLE = 'wasm32-unknown-unknown'
const KERNELS = join('sdk-browser', 'src', 'wasm')
const SORTIES = [join(ROOT, 'packages', KERNELS), join(ROOT, 'dist', KERNELS)]
const NOM = 'kernels.wasm'

function rustc(...args: string[]): string {
  return execFileSync('rustc', args, { encoding: 'utf8' }).trim()
}

/**
 * `-relaxed-simd`: the batch computation kernels of core (`packages/page-codec-wasm/src/math.rs`)
 * match the bitwise output of the JavaScript version because WebAssembly has NO fused multiply-add
 * instruction — neither in base nor `simd128`. `relaxed-simd` has one (`f64x2.relaxed_madd`), whose
 * rounding is implementation-defined: a single such instruction would break exact bit equality silently.
 * It is not enabled by default for the target, but we explicitly reject it rather than depend on it,
 * and `verifieJeuInstructions` re-reads the output module to confirm.
 *
 * `simd128`: required, and `verifieJeuInstructions` refuses a module without it; what the flag
 * gains on the batch kernels is not measured. A browser without SIMD fails instantiation, and the
 * loader falls back to the kernels' JavaScript twins.
 */

/**
 * The `target_features` custom section of the module lists each capability authorized by the compiler.
 * We require `simd128` and reject any "relaxed" feature whose instruction rounding is implementation-defined.
 */
export function verifieJeuInstructions(chemin: string): void {
  const module = new WebAssembly.Module(readFileSync(chemin))
  const [section] = WebAssembly.Module.customSections(module, 'target_features')
  if (!section) throw new Error(`${chemin}: "target_features" section missing.`)
  const noms = Buffer.from(section).toString('latin1')
  if (noms.includes('relaxed'))
    throw new Error(
      `${chemin}: "relaxed" capability present, floating-point rounding not guaranteed.`,
    )
  if (!noms.includes('simd128'))
    throw new Error(`${chemin}: simd128 missing from the produced module.`)
}

/** The host's Rust target, as `rustc -vV` names it. */
export const rustHost = (): string =>
  rustc('-vV')
    .split('\n')
    .find((ligne) => ligne.startsWith('host: '))
    ?.slice(6) ?? ''

/**
 * A tool of the `llvm-tools` component for the host, refused by name when the component is
 * missing. Apple's `ar` cannot archive WebAssembly objects: it produces an empty archive and the
 * link then fails on missing symbols; `llvm-ar` archives them properly.
 */
export function rustTool(name: string): string {
  const exe = `${name}${process.platform === 'win32' ? '.exe' : ''}`
  const chemin = join(rustc('--print', 'sysroot'), 'lib', 'rustlib', rustHost(), 'bin', exe)
  if (!existsSync(chemin))
    throw new Error(`${name} not found: ${chemin}\nInstall with: rustup component add llvm-tools`)
  return chemin
}

/** Compiles the module, verifies it, and places it alongside its loader. Nothing here is importable
 * without running `cargo build`: which is why this script only executes `main()` when invoked via CLI,
 * never when `verifieJeuInstructions` is imported for testing.
 */
function main(): void {
  /** The target standard library is either present or missing: sysroot indicates it. */
  if (!existsSync(join(rustc('--print', 'sysroot'), 'lib', 'rustlib', CIBLE)))
    throw new Error(`Target ${CIBLE} missing.\nInstall with: rustup target add ${CIBLE}`)

  const DRAPEAUX = {
    AR_wasm32_unknown_unknown: rustTool('llvm-ar'),
    CFLAGS_wasm32_unknown_unknown: '-msimd128',
    // A path dependency (`packages/math/rust`) is compiled under its absolute path, which its panic
    // locations would carry into the committed module: the checkout's root becomes `.`. The flags
    // go one per field, split by the unit separator, so a root with a space stays one flag.
    CARGO_ENCODED_RUSTFLAGS: [
      '-C',
      'target-feature=+simd128,-relaxed-simd',
      `--remap-path-prefix=${ROOT}=.`,
    ].join('\x1f'),
  }

  execFileSync(
    'cargo',
    ['build', '--release', '--locked', '--target', CIBLE, '--manifest-path', MANIFESTE],
    { stdio: 'inherit', env: { ...process.env, ...DRAPEAUX } },
  )

  const construit = join(
    dirname(MANIFESTE),
    'target',
    CIBLE,
    'release',
    'trillion3d_page_codec.wasm',
  )
  verifieJeuInstructions(construit)
  for (const dossier of SORTIES) {
    if (dossier.includes('dist') && !existsSync(dossier)) continue
    mkdirSync(dossier, { recursive: true })
    copyFileSync(construit, join(dossier, NOM))
  }
  console.log(`${NOM}: ${statSync(construit).size} bytes`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
