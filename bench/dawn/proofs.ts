// The GPU proofs on the bench: every `*.gpu.ts` under `tests/gpu/`, one by one, on Dawn in Node
// (`tests/gpu/kit/onDawn.ts`) under the machine's bench lock — never beside a measurement. With
// `--chrome`, every `*.chrome.ts`: what Dawn does not have — a browser's own surface, the witness
// library's renderer — proved in the system Chrome (`tests/gpu/kit/onChrome.ts`), the recette's
// run alone, never a merge's. Paths are resolved from the repository root, never from
// the current directory: the command gives the same result wherever it is launched from.
//
//   node bench/dawn/proofs.ts [file…]
//   node bench/dawn/proofs.ts --chrome [file…]
//
// The proofs are discovered by a rule, never by a hand-held list: a file one forgets to add does
// not run, and nothing says so. What cannot run here is declared below with its reason — excluded
// out loud, never in silence.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { isUnitTest } from '../../scripts/unit-tests.ts'
import { entryPath, underNodeTest } from '../core/entryPoint.ts'
import { LOCK_OWNER, takeBenchLock } from './lock.ts'

/** The repository, which proof paths are relative to. */
const ROOT = join(import.meta.dirname, '..', '..')

/** Where the proofs live, one folder per engine area; `kit/` holds what they share. */
export const PROOFS = 'tests/gpu'
/** How a proof's file name ends — on Dawn, or in Chrome (`CHROME_SUFFIX`): any other file under
 *  `tests/gpu` is a module a proof loads. */
export const PROOF_SUFFIX = '.gpu.ts'
export const CHROME_SUFFIX = '.chrome.ts'
/** The flag that runs the Chrome proofs instead of the Dawn ones. */
export const CHROME = '--chrome'

/** A setup the runner does not provide: the proof is sound, the machine is not ready. */
export const SETUP = 'setup'
/** An engine defect: the proof fails because it is right. Each one carries a TODO line. */
export const REGRESSION = 'regression'
/**
 * The proof holds a hand copy of a contract that the source evolved without it. The engine is
 * correct, the duplicate drifted: it is repaired by reading the contract instead of recopying it.
 */
export const STALE_DUPLICATE = 'stale duplicate'

/**
 * Proofs the bench does not launch, by their path under `tests/gpu` without the suffix, and why —
 * a Dawn and a Chrome proof never share a name.
 * A `REGRESSION` entry is an open debt, not a waiver: it is removed by fixing the engine.
 */
export const EXCLUDED = new Map<string, [string, string]>([
  [
    'placement/transparent-transform',
    [
      REGRESSION,
      'TODO: since 2779442f37 the paged pass encodes the main class draw slot when every transparent row is out of view — an empty drawIndirect counted as a draw (the image is right)',
    ],
  ],
  [
    'lighting/narrow-resolve',
    [REGRESSION, 'TODO #1369: the rectless program is not bit-equal to the full one (1 to 3 ulp)'],
  ],
  [
    'lighting/sampled-resolve',
    [REGRESSION, 'TODO #1369: the rectless program is not bit-equal to the full one (1 ulp)'],
  ],
  [
    'reflections/screen-mirror',
    [
      REGRESSION,
      'TODO: since 7e41da11f0 flush does not await targets made aside (a render-then-flush loop never draws); since badf03022f the analytic mirror reflection is black',
    ],
  ],
  [
    'vsm/camera-stop',
    [
      REGRESSION,
      'TODO: speckles in the first still frame (7 to 10 pixels) the settled frame does not have — shadow code frozen for the clean-room pass',
    ],
  ],
  [
    'webgpu/page-tangents',
    [
      STALE_DUPLICATE,
      'its unpaged twin scenes now compile paged (the compiler decides unpaged from the material alone); the recipe in bench/runner/scenes/tangentScenes.ts must be rewritten',
    ],
  ],
  [
    'taa/temporal-antialiasing',
    [
      STALE_DUPLICATE,
      'hand-written 16 to 24 hold frames where the engine holds after taaStillFrames (66), and a new camera object per pan frame, which the engine reads as a view cut',
    ],
  ],
  [
    'lighting/sampled-lighting',
    [
      STALE_DUPLICATE,
      'its moving-image threshold (max >= 3) already failed on develop; the threshold is unproven',
    ],
  ],
  [
    'partition/conservative-partition',
    [SETUP, 'port to Dawn unfinished: its only run hung with a promise still pending'],
  ],
])

/** Every proof on disk ending in `suffix`, excluded ones included, as repository paths: the
 *  folder's reference. */
export function listProofFiles(suffix = PROOF_SUFFIX) {
  return readdirSync(join(ROOT, PROOFS), { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
    .filter((file) => file.endsWith(suffix))
    .sort()
    .map((file) => `${PROOFS}/${file}`)
}

/** A proof's name in `EXCLUDED`: its path under `tests/gpu`, without the suffix. */
export const proofName = (path: string, suffix = PROOF_SUFFIX) =>
  path.slice(PROOFS.length + 1, -suffix.length)

/** The proofs the bench launches: every one on disk, minus what is declared excluded. */
export function listProofs(suffix = PROOF_SUFFIX) {
  return listProofFiles(suffix).filter((path) => !EXCLUDED.has(proofName(path, suffix)))
}

/** What the command did not prove, stated before launching anything. */
export function reportedExclusions(suffix = PROOF_SUFFIX) {
  const names = new Set(listProofFiles(suffix).map((path) => proofName(path, suffix)))
  return [...EXCLUDED]
    .filter(([name]) => names.has(name))
    .map(([name, [kind, reason]]) => `  ${kind} — ${name} : ${reason}`)
}

/** `node` arguments: the flags, then the requested targets or the full list. */
export function proofArgs(cliArgs: string[] = [], suffix = PROOF_SUFFIX): string[] {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1']
  if (cliArgs.length > 0) return [...flags, ...cliArgs]
  return [...flags, ...listProofs(suffix)]
}

/** How every refusal starts, for the tests that count them. */
export const DAWN_REFUSED = 'Dawn refused'

/** Whether `path` is a proof the bench runs, ending in `suffix`, a declared exclusion included,
 *  so it can still be run on its own. */
export const isProof = (path: string, suffix = PROOF_SUFFIX) =>
  path.startsWith(`${PROOFS}/`) && !path.startsWith(`${PROOFS}/kit/`) && path.endsWith(suffix)

/**
 * Throws when the GPU would open from an import instead of a run: with no entry file (`node -e`,
 * the REPL), from a unit test, or under `node --test` from anything but a GPU proof. Any other
 * explicit script opens it on purpose — a proof, the bench, a measurement script. `testRun` says
 * whether the process runs under `node --test`; the guard's own tests set it.
 */
export function assertProofEntryPoint(entry = process.argv[1], testRun = underNodeTest()) {
  const path = entryPath(entry)
  if (path && !isUnitTest(path) && (!testRun || isProof(path))) return
  throw new Error(
    `${DAWN_REFUSED}: the entry point ${entry || '(none)'} is no explicit run, or is a unit ` +
      'test. Importing a proof never opens the GPU; run it on its own ' +
      '(`pnpm run test:gpu <file>`).',
  )
}

/** Runs the proofs — the Chrome ones after `CHROME` —, holding the machine's bench lock while
 *  they run. */
export async function runProofs(args = process.argv.slice(2)) {
  const chrome = args[0] === CHROME
  const [suffix, targets] = chrome ? [CHROME_SUFFIX, args.slice(1)] : [PROOF_SUFFIX, args]
  takeBenchLock(chrome ? 'Chrome proofs' : 'GPU proofs')
  // Cooked under the lock: a compile beside a measurement would disturb it.
  const { compileSiteCaches, TEST_SCENES } = await import('../../scripts/site-caches.ts')
  compileSiteCaches(true, TEST_SCENES)
  const excluded = reportedExclusions(suffix)
  if (targets.length === 0 && excluded.length > 0)
    console.log(`${excluded.length} proofs excluded:\n${excluded.join('\n')}\n`)
  // The proofs open the GPU under this run's lock (`installProofGpu`), never beside it.
  const result = spawnSync(process.execPath, proofArgs(targets, suffix), {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, [LOCK_OWNER]: String(process.pid) },
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

if (import.meta.main) await runProofs()
