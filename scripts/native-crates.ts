// The repository's own Rust crates, listed once: `native.ts` tests, lints and formats them (and
// `check-changed.ts` through it), `format-staged.ts` formats the staged ones, `check-helpers.ts`
// reads each as a unit and `build-wasm.ts` compiles the WebAssembly one. `native-crates.test.ts`
// holds the list to every `Cargo.toml` of `packages/` but the third-party Jolt sources.

export interface NativeCrate {
  /** The crate's folder, from the repository root. */
  path: string
  /** Tested and linted with `--all-features`. */
  allFeatures: boolean
  /** Compiled for `wasm32-unknown-unknown` (`build-wasm.ts`). */
  wasm: boolean
}

export const NATIVE_CRATES: readonly NativeCrate[] = [
  { path: 'packages/asset-compiler-rust', allFeatures: true, wasm: false },
  { path: 'packages/page-codec-wasm', allFeatures: false, wasm: true },
  { path: 'packages/math/rust', allFeatures: true, wasm: false },
]

/** The WebAssembly crate. */
export const WASM_CRATE = NATIVE_CRATES.find((crate) => crate.wasm)!
