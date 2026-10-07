import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathDependencies, productionSources } from './buildInputs.mts'

/**
 * What the release build of the compiler is made from beside the Rust sources, relative to its
 * crate: the inputs `build.rs` hashes and watches, and the message catalogue it embeds. The Rust
 * sources — its own and those of the crates it links — are `buildInputs.mts`'s, the list the build
 * hashes. The Jolt submodule itself is left out — a change there is a new commit, already in the
 * key — and so is anything a cook could write.
 */
const BUILD_INPUTS = [
  'Cargo.toml',
  'Cargo.lock',
  'build.rs',
  'build_inputs.rs',
  '../sdk-node/src/messages/messages.json',
  '../physics-jolt-wasm/cook',
  '../physics-jolt-wasm/src/blob.h',
  '../physics-jolt-wasm/CMakeLists.txt',
  // The C and C++ flags and the target CPU, hashed into the key by `build.rs`.
  '../../.cargo/config.toml',
]

function modified(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

/** The first file under `path` modified after `since`, or null; stops at the first one found. */
export function firstNewer(path: string, since: number): string | null {
  const entry = modified(path)
  if (!entry) return null
  if (!entry.isDirectory()) return entry.mtimeMs > since ? path : null
  for (const name of readdirSync(path)) {
    const newer = firstNewer(join(path, name), since)
    if (newer) return newer
  }
  return null
}

/**
 * The crate source a built compiler is older than, or null when the binary is current. Null too
 * when there is nothing to compare: no binary (the launch reports it by contract) or no crate
 * sources beside it (an installed package ships the binary alone). Only timestamps are read while
 * nothing is newer, so a current binary costs one directory walk and no build.
 */
export function sourceNewerThan(binary: string, crate: string): string | null {
  const built = modified(binary)
  if (!built || !modified(join(crate, 'Cargo.toml'))) return null
  for (const input of BUILD_INPUTS) {
    const newer = firstNewer(join(crate, input), built.mtimeMs)
    if (newer) return newer
  }
  // A crate's sources are read, to tell its test code apart, only once one of them is newer.
  for (const linked of ['.', ...pathDependencies(crate)]) {
    const directory = join(crate, linked)
    const manifest = firstNewer(join(directory, 'Cargo.toml'), built.mtimeMs)
    if (manifest) return manifest
    if (!firstNewer(join(directory, 'src'), built.mtimeMs)) continue
    const newer = productionSources(directory).find(
      (source) => (modified(source)?.mtimeMs ?? 0) > built.mtimeMs,
    )
    if (newer) return newer
  }
  return null
}
