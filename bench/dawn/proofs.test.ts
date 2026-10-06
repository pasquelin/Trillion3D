import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitPaths } from '../../scripts/git-paths.ts'
import {
  CHROME_SUFFIX,
  DAWN_REFUSED,
  EXCLUDED,
  PROOFS,
  PROOF_SUFFIX,
  REGRESSION,
  SETUP,
  STALE_DUPLICATE,
  assertProofEntryPoint,
  listProofFiles,
  listProofs,
  proofArgs,
  proofName,
} from './proofs.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const at = (path: string) => join(ROOT, path)
/** The two targets, by how their proofs' names end. */
const SUFFIXES = [PROOF_SUFFIX, CHROME_SUFFIX]

test('each proof exists, in an engine area folder, under the name the convention requires', () => {
  const proofs = SUFFIXES.flatMap((suffix) => listProofFiles(suffix))
  for (const suffix of SUFFIXES) assert.ok(listProofFiles(suffix).length > 0, `no ${suffix} proof`)
  for (const proof of proofs) {
    assert.match(proof, /^tests\/gpu\/[a-z0-9-]+\/[a-z0-9]+(-[a-z0-9]+)*\.(gpu|chrome)\.ts$/)
    assert.ok(!proof.startsWith(`${PROOFS}/kit/`), `${proof}: the kit holds no proof`)
    assert.ok(existsSync(at(proof)), `${proof} does not exist`)
  }
})

// A module under `tests/gpu` that no file names never runs: a page or a case set left behind.
test('no module under tests/gpu is left behind: each is named by another file', async () => {
  const modules = readdirSync(at(PROOFS), { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
    .filter((file) => /\.(ts|mts)$/.test(file) && !SUFFIXES.some((end) => file.endsWith(end)))
    .filter((file) => !file.endsWith('.test.ts'))
  const tracked = (await gitPaths(['ls-files', '-z'], ROOT)).filter((f) =>
    /\.(mjs|ts|mts)$/.test(f),
  )
  const texts = new Map<string, string>(tracked.map((f) => [f, readFileSync(at(f), 'utf8')]))
  for (const module of modules) {
    const name = module.split('/').pop()!
    const named = tracked.some(
      (other) => other !== `${PROOFS}/${module}` && (texts.get(other)?.includes(name) ?? false),
    )
    assert.ok(named, `${module} is named by no other file: it never runs`)
  }
})

test('no exclusion outlives the proof it names, and each states its category', () => {
  const names = SUFFIXES.flatMap((suffix) =>
    listProofFiles(suffix).map((path) => proofName(path, suffix)),
  )
  const onDisk = new Set(names)
  assert.equal(onDisk.size, names.length, 'a Dawn and a Chrome proof share a name')
  for (const [name, [kind, reason]] of EXCLUDED) {
    assert.ok(onDisk.has(name), `${name} is excluded but no longer exists: remove the entry`)
    assert.ok([SETUP, REGRESSION, STALE_DUPLICATE].includes(kind), `${name}: unknown kind ${kind}`)
    assert.ok(reason.length > 10, `${name}: reason too short to state anything`)
  }
  assert.equal(listProofs().length + listProofs(CHROME_SUFFIX).length + EXCLUDED.size, onDisk.size)
})

test('proofArgs runs every proof by default, serially, and the targets given otherwise', () => {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1']
  assert.deepEqual(proofArgs([]), [...flags, ...listProofs()])
  assert.deepEqual(proofArgs([], CHROME_SUFFIX), [...flags, ...listProofs(CHROME_SUFFIX)])
  assert.deepEqual(proofArgs(['tests/gpu/a/b.gpu.ts']), [...flags, 'tests/gpu/a/b.gpu.ts'])
})

test('under node --test, only a GPU proof may open the GPU', () => {
  assert.doesNotThrow(() => assertProofEntryPoint(at(listProofFiles()[0]), true))
  const chrome = at(listProofFiles(CHROME_SUFFIX)[0])
  for (const entry of ['', fileURLToPath(import.meta.url), at('tests/gpu/kit/onDawn.ts'), chrome])
    assert.throws(() => assertProofEntryPoint(entry, true), new RegExp(DAWN_REFUSED), entry)
})

test('any explicit script but a unit test may open the GPU, wherever it lives', () => {
  for (const run of [at(listProofFiles()[0]), at('bench/runner/waterCost.ts')])
    assert.doesNotThrow(() => assertProofEntryPoint(run, false), run)
  for (const entry of ['', fileURLToPath(import.meta.url), at('absent-script.ts')])
    assert.throws(() => assertProofEntryPoint(entry, false), new RegExp(DAWN_REFUSED), entry)
})
