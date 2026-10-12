/**
 * The fingerprint of the reference scenes' caches: every file a compiler writes for them, by the
 * SHA-256 of its bytes, so that two compilers that cook the same bytes have the same one — the five
 * platforms of one commit, and a branch against `develop`. What a cook writes beside its bytes is
 * not compared: the run's report (a key ending in `Ms`, `peakRssBytes`, `reusedPages` and the run's
 * settings `threads`, `ramBudgetMb`, `admissionEstimatedBytes`, `compileWaves`, as
 * `compiler_manifest_pages` names them, and `found`, whether a run found a cutout sheet) and the
 * folder it was written to. A name made of a SHA-256 — the cache key, which hashes the compiler's
 * own sources, and each content-addressed file — reads `<sha>`: such files are still compared by
 * content, the hashes of the files one pattern names listed together. The Jolt collider shapes a
 * scene's `physics.json` names are listed apart, `(Jolt collider)`: against a base whose Jolt cook
 * still fuses multiply-adds (`--colliders-may-differ`, which the `Compiler` workflow passes only
 * while the base's `build.rs` lacks Jolt's cross-platform mode), every other file is compared, the
 * colliders changing once to the unfused bytes.
 *
 * The rule of the versions (`docs/FORMAT.md` "Versions"): the bytes of a file family never change
 * for unchanged sources unless the family's version does. Against `develop` (`--against-base`) a
 * file that differs is allowed when a version of its family differs too, listed `changed on
 * purpose (name vN → vM)`; with none changed it fails, naming the version to bump. The platforms
 * among themselves are always compared strictly.
 *
 *   node scripts/compiler-hashes.ts <compiler> <record.json> [<name>]
 *   node scripts/compiler-hashes.ts --compare [--against-base] [--colliders-may-differ] <reference> <record>...
 *     (`--against-base`: <reference> is the branch's record, the one record after it `develop`'s)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { MIB } from '../packages/math/src/constants.ts'
import { sha256 } from '../packages/sdk-node/src/compiler/provenance.mts'
import { cacheVersions, classify } from './compiler-versions.ts'
import { compileFullCache } from './native-compiler.ts'
import { TEST_SCENES } from './scene-caches.ts'
import { REPOSITORY_ROOT, readJson, filesUnder, posixPath } from './repository-files.ts'

/** The scenes the distributed compiler is proved and trained on, both committed and read by the
 *  tests alone: a terrain of one large mesh, and a garden of parametric rings under a light. */
export const REFERENCE_SCENES = ['mountain-terrain', 'kinetic-garden'] as const

/** A compiler's fingerprint of the reference scenes; `bytes`, its size, when it is distributed. */
export interface HashRecord {
  compiler: string
  bytes?: number
  files: Record<string, string>
  /** The versions the cache itself declares (`cacheVersions`); absent from an older record. */
  versions?: Record<string, string>
}

const SHA = /[0-9a-f]{64}/g
/** An object of the cache, content-addressed; `physics.json` names its colliders' tiles so. */
const OBJECT = /objects[\\/]([0-9a-f]{64})\.bin$/
const COLLIDER = ' (Jolt collider)'
/** What a run reports rather than builds: its times, its memory peak, the pages it found built,
 *  its settings, whether it found a cutout sheet. */
const MEASURE =
  /Ms$|^(peakRssBytes|reusedPages|threads|ramBudgetMb|admissionEstimatedBytes|compileWaves|found)$/

/** A JSON file of `cache` without its run's measures, its folder read `<cache>`; other bytes as is. */
function comparable(bytes: Buffer, file: string, cache: string): Buffer | string {
  if (!file.endsWith('.json')) return bytes
  const document: unknown = JSON.parse(bytes.toString('utf8'), (key, value: unknown) => {
    if (MEASURE.test(key)) return undefined
    if (typeof value !== 'string' || !value.includes(cache)) return value
    return posixPath(value.replaceAll(cache, '<cache>'))
  })
  return JSON.stringify(document)
}

/** Each file of the compiled cache `cache`, under `prefix`, by the SHA-256 of what is compared;
 *  names and contents with `<sha>` for a SHA-256. The lock of a finished cook is skipped. */
export function cacheFingerprint(cache: string, prefix: string): Record<string, string> {
  const hashes = new Map<string, string[]>()
  const files = filesUnder(cache)
    .filter((path) => !path.endsWith('.lock'))
    .map((path) => relative(cache, path))
  const colliders = new Set(
    files
      .filter((file) => file.endsWith('physics.json'))
      .flatMap((file) => readFileSync(join(cache, file), 'utf8').match(SHA) ?? []),
  )
  for (const file of files) {
    const content = comparable(readFileSync(join(cache, file)), file, cache)
    const text = typeof content === 'string' ? content.replaceAll(SHA, '<sha>') : content
    const collider = colliders.has(OBJECT.exec(file)?.[1] ?? '') ? COLLIDER : ''
    const name = `${prefix}/${posixPath(file).replaceAll(SHA, '<sha>')}${collider}`
    const list = hashes.get(name) ?? []
    list.push(sha256(text))
    hashes.set(name, list)
  }
  return Object.fromEntries(
    [...hashes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => [name, list.sort().join(' ')]),
  )
}

/** Compiles every reference scene with `executable` into a fresh folder, handed to `visit` before
 *  it is removed; with no `visit`, a training run of profile-guided optimisation. */
export function compileReferenceScenes(
  executable: string,
  visit: (cache: string, name: string) => void = () => {},
): void {
  for (const name of REFERENCE_SCENES) {
    const { directory, ...compile } = TEST_SCENES[name]
    const cache = mkdtempSync(join(tmpdir(), `trillion3d-${name}-`))
    try {
      compileFullCache({
        cwd: resolve(REPOSITORY_ROOT, directory),
        ...compile,
        cache,
        executable,
        stdio: ['ignore', 'ignore', 'inherit'],
      })
      visit(cache, name)
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
  }
}

/** Every reference scene compiled with `executable`, fingerprinted, with the versions its caches declare. */
export function referenceRecord(executable: string): Pick<HashRecord, 'files' | 'versions'> {
  const files: Record<string, string> = {}
  const versions: Record<string, string> = {}
  compileReferenceScenes(executable, (cache, name) => {
    Object.assign(files, cacheFingerprint(cache, name))
    Object.assign(versions, cacheVersions(cache))
  })
  return { files, versions }
}

/** The files whose hash differs between two fingerprints, one missing on either side included;
 *  the Jolt colliders left out when they `mayDiffer`. */
export function differences(reference: HashRecord, other: HashRecord, mayDiffer = false): string[] {
  const names = new Set([...Object.keys(reference.files), ...Object.keys(other.files)])
  return [...names]
    .filter((name) => reference.files[name] !== other.files[name])
    .filter((name) => !(mayDiffer && name.endsWith(COLLIDER)))
    .sort()
}

/** One line per record: its digest over every file, its size, and what differs from the first. */
function compare(paths: string[], collidersMayDiffer: boolean, againstBase: boolean): boolean {
  const records = paths.map((path) => readJson(path) as HashRecord)
  let equal = true
  for (const record of records) {
    const { allowed, failures } = againstBase
      ? classify(record, records[0], differences(record, records[0], collidersMayDiffer))
      : { allowed: new Map<string, string[]>(), failures: undefined }
    const differing = failures
      ? failures.map((f) => f.file)
      : differences(records[0], record, collidersMayDiffer)
    const size = record.bytes === undefined ? '' : `, ${(record.bytes / MIB).toFixed(1)} MiB`
    const digest = sha256(JSON.stringify(record.files))
    const files = Object.values(record.files).join(' ').split(' ').length
    console.log(`${record.compiler}: ${files} files, ${digest}${size}`)
    for (const [label, list] of allowed)
      console.log(`  changed on purpose (${label}): ${list.length} files, e.g. ${list[0]}`)
    for (const file of differing) {
      const bump = failures?.find((f) => f.file === file)?.bump
      const hint = bump
        ? `; bytes changed, version not: bump ${bump.join(' or ')} (docs/FORMAT.md "Versions")`
        : ''
      console.log(`  differs from ${records[0].compiler}: ${file}${hint}`)
    }
    const changed = differences(records[0], record).length - differing.length
    if (changed)
      console.log(`  its Jolt colliders differ in ${changed} scenes: allowed, the base fuses`)
    equal &&= differing.length === 0
  }
  return equal
}

if (import.meta.filename === process.argv[1]) {
  const [first, ...rest] = process.argv.slice(2)
  if (first === '--compare') {
    const flags = rest.filter((a) => a.startsWith('--'))
    const paths = rest.filter((a) => !a.startsWith('--'))
    if (!compare(paths, flags.includes('--colliders-may-differ'), flags.includes('--against-base')))
      process.exit(1)
  } else {
    const record: HashRecord = {
      compiler: rest[1] ?? first,
      ...referenceRecord(resolve(first)),
    }
    writeFileSync(rest[0], `${JSON.stringify(record, null, 2)}\n`)
  }
}
