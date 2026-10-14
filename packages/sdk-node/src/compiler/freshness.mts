import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The message catalogue the compiler embeds, from its crate: read by the release build but left out
 *  of its hash on purpose (no cache byte depends on it, `messages.rs`), so not in the list it prints. */
const CATALOGUE = '../sdk-node/src/messages/messages.json'

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
 *  ending in `/`, then the files it hashed, as paths from its crate. Null when the binary
 *  definitely cannot tell (it exited with a status: the flag is unknown to it); undefined when it
 *  could not answer this time (timeout, signal, spawn error): nothing is learnt about the binary. */
type BuildInputs = (binary: string) => string[] | null | undefined

/** Asks the binary. */
const askBinary: BuildInputs = (binary) => {
  const run = spawnSync(binary, ['--build-inputs'], { encoding: 'utf8', timeout: 30_000 })
  if (run.error || run.signal || run.status === null) return undefined
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

/** The answer of a build, kept beside its binary: a new process reads it rather than spawn it.
 *  `lastGood` is the latest real listing of any build of this binary, kept through builds that
 *  could not list. */
const answerFile = (binary: string) => `${binary}.build-inputs.json`

type Stored = { builtAt: number; listing: Listing; lastGood?: Listing }

function readStored(binary: string): Stored | undefined {
  try {
    return JSON.parse(readFileSync(answerFile(binary), 'utf8')) as Stored
  } catch {
    return undefined
  }
}

/** The folders a binary that cannot list its inputs was built from. One that predates
 *  `--build-inputs` was built from the crates beside the compiler's, the page codec and the math
 *  crate, which the compiler's manifest links by path; an older build's listing, when kept, is
 *  the better witness of them. */
const LINKED_FOLDERS = ['.', '../page-codec-wasm', '../math/rust']

/** The binary's answer by binary and build time: asked once per build, not on every launch nor
 *  in every process — in memory, then on disk beside the binary. A binary that could not answer
 *  (timeout, signal) is remembered as failed in memory only, for this process and this build time:
 *  it is not asked again here, and not written to disk, so the next process asks again. */
const listed = new Map<string, { builtAt: number; listing: Listing; lastGood: Listing }>()
function listOf(
  binary: string,
  builtAt: number,
  ask: BuildInputs,
): { listing: Listing; lastGood: Listing } {
  const known = listed.get(binary)
  if (known?.builtAt === builtAt) return { listing: known.listing, lastGood: known.lastGood }
  const stored = readStored(binary)
  const lastGood = stored?.lastGood ?? stored?.listing ?? null
  if (stored?.builtAt === builtAt) {
    listed.set(binary, { builtAt, listing: stored.listing, lastGood })
    return { listing: stored.listing, lastGood }
  }
  const lines = ask(binary)
  if (lines === undefined) {
    listed.set(binary, { builtAt, listing: null, lastGood })
    return { listing: null, lastGood }
  }
  const answer = listing(lines)
  try {
    writeFileSync(
      answerFile(binary),
      JSON.stringify({ builtAt, listing: answer, lastGood: answer ?? lastGood }),
    )
  } catch {
    // A read-only build folder: the next process asks again.
  }
  listed.set(binary, { builtAt, listing: answer, lastGood: answer ?? lastGood })
  return { listing: answer, lastGood: answer ?? lastGood }
}

/**
 * The input a built compiler is older than, or null when the binary is current. Null too when
 * there is nothing to compare: no binary (the launch reports it by contract) or no crate sources
 * beside it (an installed package ships the binary alone). The binary names the crate folders its
 * build read, once per build; only timestamps are read while nothing in them is newer, so a
 * current binary costs one directory walk. A newer file there may be test code, which the build
 * leaves out: the binary's list of what it hashed then decides, so a launch calls it stale exactly
 * when its hash would move. A binary that cannot tell — built before `--build-inputs`, or not answering — still has its
 * linked crate folders walked (see LINKED_FOLDERS): any newer file there makes it stale.
 */
export function sourceNewerThan(
  binary: string,
  crate: string,
  ask: BuildInputs = askBinary,
): string | null {
  const built = modified(binary)
  if (!built || !modified(join(crate, 'Cargo.toml'))) return null
  const { listing: read, lastGood } = listOf(binary, built.mtimeMs, ask)
  const known = read ?? lastGood
  const folders = known?.folders ?? LINKED_FOLDERS
  // The inputs outside every crate folder — the catalogue, and of the hashed files the cargo
  // configuration and the physics cook's sources — are in no walk: each, newer, is enough.
  const inside = (file: string) =>
    folders.some((folder) =>
      folder === '.' ? !file.startsWith('../') : file.startsWith(`${folder}/`),
    )
  const beside = [CATALOGUE, ...(known?.files ?? []).filter((file) => !inside(file))]
  const newerOf = (paths: string[], skip?: (name: string) => boolean) =>
    paths.reduce<string | null>(
      (found, path) => found ?? firstNewer(join(crate, path), built.mtimeMs, skip),
      null,
    )
  const outside = newerOf(beside)
  if (outside) return outside
  const newer = newerOf(folders, product)
  if (!newer || !read) return newer
  const inputs = read.files.map((file) => join(crate, file))
  return inputs.find((input) => (modified(input)?.mtimeMs ?? 0) > built.mtimeMs) ?? null
}
