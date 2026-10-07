import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What the release build of the compiler reads beside the list its binary prints, relative to its
 * crate: the message catalogue it embeds and the physics cook's sources `build.rs` hashes. Always
 * inputs, so one newer than the binary is enough. The Jolt submodule itself is left out — a change
 * there is a new commit, already in the key — and so is anything a cook could write.
 */
const READ_BESIDE = [
  '../sdk-node/src/messages/messages.json',
  '../physics-jolt-wasm/cook',
  '../physics-jolt-wasm/src/blob.h',
  '../physics-jolt-wasm/src/mesh.h',
  '../physics-jolt-wasm/src/softSettings.h',
  '../physics-jolt-wasm/src/words.h',
  '../physics-jolt-wasm/CMakeLists.txt',
]

/** The cargo configuration, whose C and C++ flags the build hashes: outside every crate folder. */
const CARGO_CONFIG = '../../.cargo/config.toml'

/** In a crate's folder, its build products and installs: never an input. */
const PRODUCTS = new Set(['target', 'node_modules'])
const product = (name: string) => PRODUCTS.has(name)

function modified(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

/** The first file under `path` modified after `since`, or null; stops at the first one found.
 *  The folders `skip` names are not entered. */
export function firstNewer(
  path: string,
  since: number,
  skip: (name: string) => boolean = () => false,
): string | null {
  const entry = modified(path)
  if (!entry) return null
  if (!entry.isDirectory()) return entry.mtimeMs > since ? path : null
  for (const name of readdirSync(path)) {
    if (skip(name)) continue
    const newer = firstNewer(join(path, name), since, skip)
    if (newer) return newer
  }
  return null
}

/**
 * The folders of `crate` and of the crates its manifest names by a `path`, theirs too: where a Rust
 * input of the binary can be. A superset — every `path = "…"` of every table, a test-only one too —,
 * since it only chooses where to look for a newer file; the binary's own list decides.
 */
function crateFolders(crate: string): string[] {
  const folders = [crate]
  for (let at = 0; at < folders.length; at++) {
    const manifest = readFileSync(join(folders[at], 'Cargo.toml'), 'utf8')
    for (const [, path] of manifest.matchAll(/\bpath\s*=\s*["']([^"']*)["']/g)) {
      const folder = join(folders[at], path)
      if (!folders.includes(folder) && modified(join(folder, 'Cargo.toml'))) folders.push(folder)
    }
  }
  return folders
}

/** The files a compiler's build hashed, as paths from its crate, or null when it cannot tell. */
type BuildInputs = (binary: string) => string[] | null

/** Asks the binary (`trillion3d-compiler --build-inputs`); null for one built before the flag. */
const askBinary: BuildInputs = (binary) => {
  const run = spawnSync(binary, ['--build-inputs'], { encoding: 'utf8', timeout: 30_000 })
  if (run.status !== 0) return null
  return run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** The binary's list by binary and build time: asked once per build, not on every launch. */
const listed = new Map<string, { builtAt: number; files: string[] | null }>()
function listOf(binary: string, builtAt: number, ask: BuildInputs) {
  const known = listed.get(binary)
  if (known?.builtAt === builtAt) return known.files
  const files = ask(binary)
  listed.set(binary, { builtAt, files })
  return files
}

/**
 * The input a built compiler is older than, or null when the binary is current. Null too when
 * there is nothing to compare: no binary (the launch reports it by contract) or no crate sources
 * beside it (an installed package ships the binary alone). Only timestamps are read while nothing
 * is newer, so a current binary costs one directory walk. A newer file in a crate's folder may be
 * test code, which the build leaves out: the binary's list of what it hashed then decides, so a
 * launch calls it stale exactly when its hash would move — and any newer file does for a binary
 * that cannot tell.
 */
export function sourceNewerThan(
  binary: string,
  crate: string,
  ask: BuildInputs = askBinary,
): string | null {
  const built = modified(binary)
  if (!built || !modified(join(crate, 'Cargo.toml'))) return null
  for (const input of READ_BESIDE) {
    const newer = firstNewer(join(crate, input), built.mtimeMs)
    if (newer) return newer
  }
  const watched = [join(crate, CARGO_CONFIG), ...crateFolders(crate)]
  const newer = watched.reduce<string | null>(
    (found, path) => found ?? firstNewer(path, built.mtimeMs, product),
    null,
  )
  if (!newer) return null
  const files = listOf(binary, built.mtimeMs, ask)
  if (!files) return newer
  const inputs = files.map((file) => join(crate, file))
  return inputs.find((input) => (modified(input)?.mtimeMs ?? 0) > built.mtimeMs) ?? null
}
