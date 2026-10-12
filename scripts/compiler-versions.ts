/**
 * The versions a compiled cache declares and the rule that ties them to its bytes (`docs/FORMAT.md`
 * "The version rule"): a file family's bytes change only with its version.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HashRecord } from './compiler-hashes.ts'

/** A JSON file of the cache, or `undefined` when it is absent. */
function jsonIn(path: string): Record<string, unknown> | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : undefined
}

/** The second word of a binary file's header: the version its format declares. */
function headerVersion(path: string): number | undefined {
  return existsSync(path) ? readFileSync(path).readUInt32LE(4) : undefined
}

const field = (value: unknown, ...path: string[]): string | undefined => {
  let at: unknown = value
  for (const key of path) at = (at as Record<string, unknown> | undefined)?.[key]
  return at === undefined || at === null ? undefined : String(at)
}

/** Every version a compiled cache declares, by the name `FAMILIES` gives it, read from the cache's
 *  own files so that any compiler's output answers: a version it does not write is absent. */
export function cacheVersions(cache: string): Record<string, string> {
  const pointer = jsonIn(join(cache, 'native/full/manifest.json'))
  const key = field(pointer, 'key')
  const folder = key === undefined ? undefined : join(cache, 'native/full', key)
  if (folder === undefined) return {}
  const root = jsonIn(join(folder, 'clusters.json'))
  const head = jsonIn(join(folder, `manifest-page-${field(root, 'head')?.slice(0, 64)}.json`))
  const physics = jsonIn(join(folder, 'physics.json'))
  const tables = jsonIn(join(folder, 'scene-tables.json'))
  const binary = readdirSync(folder).find((f) => /^manifest-page-.*\.bin$/.test(f))
  const versions: Record<string, string | undefined> = {
    cacheFormat: field(root, 'formatVersion'),
    compiler: field(root, 'compilerVersion'),
    manifestBinary: binary && String(headerVersion(join(folder, binary))),
    geometryPages: field(head, 'geometryPages', 'formatVersion'),
    errorModel: field(head, 'errorModel'),
    clusterStrategy: field(head, 'clusterStrategy'),
    textures: field(head, 'textures', 'version'),
    impostors: field(head, 'impostors', 'version'),
    scenePlugin: field(head, 'scenePlugin', 'version'),
    worldRoots: field(head, 'worldRoots', 'version'),
    physicsFormat: field(physics, 'formatVersion'),
    physicsStage: field(physics, 'stage', 'version'),
    jolt: field(physics, 'jolt'),
    lights: field(jsonIn(join(folder, 'lights.json')), 'sceneLightVersion'),
    proxy: existsSync(join(folder, 'proxy.bin'))
      ? String(headerVersion(join(folder, 'proxy.bin')))
      : undefined,
    sceneTables: field(tables, 'version'),
    nodeTable: field(tables, 'nodeTableVersion'),
    materialTable: field(tables, 'materialTableVersion'),
    geometryTable: field(tables, 'geometryTableVersion'),
  }
  return Object.fromEntries(Object.entries(versions).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >
}

/** The file families of a cache, each with the versions whose change may change its bytes; a file
 *  matching none, or `null`, answers to every version (an object holds pages, bundles, colliders;
 *  the head page and `clusters.json` embed every section's report). The first match wins. */
const FAMILIES: { file: RegExp; versions: string[] | null }[] = [
  { file: /\/native\/full\/manifest\.json$/, versions: ['cacheFormat'] },
  { file: /\/world-roots\.(bin|dag|table)$/, versions: ['worldRoots'] },
  { file: /\/manifest-page-<sha>\.bin$/, versions: ['manifestBinary', 'cacheFormat'] },
  { file: /\/lights\.json$/, versions: ['lights'] },
  { file: /\/proxy\.bin$/, versions: ['proxy'] },
  {
    file: /\/scene-tables\.json$/,
    versions: ['sceneTables', 'nodeTable', 'materialTable', 'geometryTable', 'geometryPages'],
  },
  {
    file: /\/physics\.json$|\(Jolt collider\)$/,
    versions: ['physicsFormat', 'physicsStage', 'jolt', 'compiler'],
  },
]

/** The versions that differ between two records, `name` to `[before, after]`. */
function changedVersions(
  reference: HashRecord,
  other: HashRecord,
): Record<string, [string | undefined, string | undefined]> {
  const [a, b] = [reference.versions ?? {}, other.versions ?? {}]
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return Object.fromEntries(names.filter((n) => a[n] !== b[n]).map((n) => [n, [a[n], b[n]]]))
}

/** What differs between a base and a branch, split by the versions rule: the files `allowed`,
 *  grouped under the `name vN → vM` of the version that changed, and the `failures`, files whose
 *  bytes changed with none of their family's versions. */
export function classify(reference: HashRecord, other: HashRecord, differing: string[]) {
  const changed = changedVersions(reference, other)
  const allowed = new Map<string, string[]>()
  const failures: { file: string; bump: string[] }[] = []
  for (const file of differing) {
    const family = FAMILIES.find((f) => f.file.test(file))
    const names = family?.versions ?? Object.keys({ ...reference.versions, ...other.versions })
    const moved = names.filter((n) => n in changed)
    if (moved.length === 0) failures.push({ file, bump: family?.versions ?? ['any version'] })
    for (const n of moved) {
      const label = `${n} v${changed[n][0] ?? '∅'} → v${changed[n][1] ?? '∅'}`
      allowed.set(label, [...(allowed.get(label) ?? []), file])
    }
  }
  return { allowed, failures }
}
