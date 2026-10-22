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
import { DEFAULT_RAM_BUDGET_MB } from '../../packages/sdk-core/src/contracts/compilerAbi.ts'
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
  /** Memory the compiler may use, in MB: the SDK's own default when omitted. */
  ramMb?: number
  simplification?: 'none' | 'qem-endpoints'
  /** The HLOD, either form (`resolveHlod`); none when left out. */
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
  ramMb = DEFAULT_RAM_BUDGET_MB,
  // Explicit `none`, not the compiler's default: the reference caches and hashes are pinned on it.
  simplification = 'none',
  stdio = 'inherit',
  executable = nativeCompiler(),
  hlod,
  ...options
}: FullCompile) {
  runChecked(
    executable,
    compilerArguments(
      {
        source,
        cache,
        scope: 'full',
        triangleBudget: TRIANGLE_BUDGET,
        threads,
        ramBudgetMb: String(ramMb),
        resourceBaseUrl: resourceBase,
        simplification,
      },
      { hlod, ...options },
    ),
    { cwd, stdio },
  )
}
