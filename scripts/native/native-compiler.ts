/**
 * The native compiler as the repository's own tools run it: the scene generators, the scene
 * caches, the render proofs and the bench. One executable rule — the SDK's own
 * (`currentCompilerExecutable`: `TRILLION3D_COMPILER_BIN`, else this checkout's release build,
 * refused while older than its sources) — and one triangle budget for every full cache.
 */
import type { StdioOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { currentCompilerExecutable } from '../../packages/sdk-node/src/compiler/executable.mts'
import { compilerArguments } from '../../packages/sdk-node/src/compiler/arguments.mts'
import type { HlodOptions } from '../../packages/sdk-core/src/contracts/hlodOptions.ts'
import type { JobOptions } from '../../packages/sdk-core/src/contracts/jobOptions.ts'
import { runChecked } from '../test/run.ts'

/** The triangle budget of a `full` cache, the one every measured scene uses. */
export const TRIANGLE_BUDGET = '150000'

/** The compiler a cook runs; a cook asks first, so a stale build is refused before it writes. */
export const nativeCompiler = () => currentCompilerExecutable()

/** The compiler a cook runs, refused when it is not built. */
export function requireNativeCompiler(): void {
  const compiler = nativeCompiler()
  if (!existsSync(compiler))
    throw new Error(`native compiler absent: ${compiler} — run \`pnpm run build:native\``)
}

/** One `full` compile of `source` into `cache`, both relative to `cwd`, with the job's options
 *  — its HLOD and the others the SDK's jobs name (`JobOptions`) —, each a flag as the SDK's own
 *  compile writes it. */
export interface FullCompile extends JobOptions {
  cwd: string
  source: string
  /** Where the cache is written: `cache` beside the source by default. */
  cache?: string
  /** Prefix of the resource URLs the cache records; relative by default, since a cache that
   *  names the machine it was built on is refused (`self-contained-repository.test.ts`). */
  resourceBase?: string
  /** Threads the compiler may use: the compiler's own default, every core, when omitted. */
  threads?: number
  ramMb?: number
  simplification?: 'none' | 'qem-endpoints'
  /** The HLOD, either form (`resolveHlod`); none when left out. It needs `simplification:
   *  'qem-endpoints'`: exact clusters build none, so the pair is refused. */
  hlod?: HlodOptions | null
  stdio?: StdioOptions
  /** The compiler to run: this checkout's by default (`nativeCompiler`). */
  executable?: string
}

/** Compiles one full cache with the native compiler; throws when it cannot start or fails. */
export function compileFullCache({
  cwd,
  source,
  cache = 'cache',
  resourceBase = '../../../../source/',
  threads,
  ramMb = 256,
  // Explicit `none`, not the compiler's default: the reference caches and hashes are pinned on it.
  simplification = 'none',
  stdio = 'inherit',
  executable = nativeCompiler(),
  hlod,
  ...options
}: FullCompile) {
  // Exact clusters (`none`) are never simplified, so the compiler builds no HLOD of them and
  // ignores the flag: a job naming both is refused, not written and silently dropped.
  if (hlod && simplification === 'none')
    throw new Error(
      "`hlod` needs `simplification: 'qem-endpoints'`: with `simplification: 'none'` the compiler " +
        'builds exact clusters and no HLOD',
    )
  runChecked(
    executable,
    compilerArguments(
      {
        source,
        cache,
        scope: 'full',
        triangleBudget: TRIANGLE_BUDGET,
        // Empty: the compiler's own default (`machine_threads`).
        threads: threads === undefined ? '' : String(threads),
        ramBudgetMb: String(ramMb),
        resourceBaseUrl: resourceBase,
        simplification,
      },
      { hlod, ...options },
    ),
    { cwd, stdio },
  )
}
