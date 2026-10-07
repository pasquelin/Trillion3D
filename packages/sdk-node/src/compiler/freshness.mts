import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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

/** The lines of `trillion3d-compiler --build-inputs`: the crate folders its build read, each
 *  ending in `/`, then the files it hashed, as paths from its crate; null when it cannot tell. */
type BuildInputs = (binary: string) => string[] | null

/** Asks the binary; null for one built before the flag. */
const askBinary: BuildInputs = (binary) => {
  const run = spawnSync(binary, ['--build-inputs'], { encoding: 'utf8', timeout: 30_000 })
  if (run.status !== 0) return null
  return run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** What a build read: the folders of its crates and the files it hashed, from its crate. */
type Listing = { folders: string[]; files: string[] } | null

function listing(lines: string[] | null): Listing {
  if (!lines) return null
  const folders = lines.filter((line) => line.endsWith('/')).map((line) => line.slice(0, -1))
  return folders.length ? { folders, files: lines.filter((line) => !line.endsWith('/')) } : null
}

/** The answer of a build, kept beside its binary: a new process reads it rather than spawn it. */
const answerFile = (binary: string) => `${binary}.build-inputs.json`

function storedAnswer(binary: string, builtAt: number): Listing | undefined {
  try {
    const stored = JSON.parse(readFileSync(answerFile(binary), 'utf8')) as {
      builtAt: number
      listing: Listing
    }
    return stored.builtAt === builtAt ? stored.listing : undefined
  } catch {
    return undefined
  }
}

/** The binary's answer by binary and build time: asked once per build, not on every launch nor
 *  in every process — in memory, then on disk beside the binary. */
const listed = new Map<string, { builtAt: number; listing: Listing }>()
function listOf(binary: string, builtAt: number, ask: BuildInputs): Listing {
  const known = listed.get(binary)
  if (known?.builtAt === builtAt) return known.listing
  let answer = storedAnswer(binary, builtAt)
  if (answer === undefined) {
    answer = listing(ask(binary))
    try {
      writeFileSync(answerFile(binary), JSON.stringify({ builtAt, listing: answer }))
    } catch {
      // A read-only build folder: the next process asks again.
    }
  }
  listed.set(binary, { builtAt, listing: answer })
  return answer
}

/**
 * The input a built compiler is older than, or null when the binary is current. Null too when
 * there is nothing to compare: no binary (the launch reports it by contract) or no crate sources
 * beside it (an installed package ships the binary alone). The binary names the crate folders its
 * build read, once per build; only timestamps are read while nothing in them is newer, so a
 * current binary costs one directory walk. A newer file there may be test code, which the build
 * leaves out: the binary's list of what it hashed then decides, so a launch calls it stale exactly
 * when its hash would move. A binary that cannot tell — built before `--build-inputs` — names no
 * crate either: any newer file of its own crate makes it stale.
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
  const read = listOf(binary, built.mtimeMs, ask)
  const folders = read ? read.folders.map((folder) => join(crate, folder)) : [crate]
  const newer = [join(crate, CARGO_CONFIG), ...folders].reduce<string | null>(
    (found, path) => found ?? firstNewer(path, built.mtimeMs, product),
    null,
  )
  if (!newer || !read) return newer
  const inputs = read.files.map((file) => join(crate, file))
  return inputs.find((input) => (modified(input)?.mtimeMs ?? 0) > built.mtimeMs) ?? null
}
