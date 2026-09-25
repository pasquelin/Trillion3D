/**
 * The native compiler as the repository's own tools run it: the scene generators, the gallery
 * recipes, the render proofs and the bench. One executable rule — the SDK's own
 * (`currentCompilerExecutable`: `TRILLION3D_COMPILER_BIN`, else this checkout's release build,
 * refused while older than its sources) — and one triangle budget for every full cache.
 */
import { spawnSync, type StdioOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { currentCompilerExecutable } from '../packages/sdk-node/src/compiler/process.mts';

/** The triangle budget of a `full` cache, the one every published and measured scene uses. */
export const TRIANGLE_BUDGET = '150000';

/** The compiler a cook runs; a cook asks first, so a stale build is refused before it writes. */
export const nativeCompiler = () => currentCompilerExecutable();

/** The compiler a cook runs, refused when it is not built. */
export function requireNativeCompiler(): string {
  const compiler = nativeCompiler();
  if (!existsSync(compiler))
    throw new Error(`native compiler absent: ${compiler} — run \`pnpm run build:native\``);
  return compiler;
}

/** One `full` compile of `source` into `cache`, both relative to `cwd`. */
export interface FullCompile {
  cwd: string;
  source: string;
  /** Where the cache is written: `cache` beside the source by default. */
  cache?: string;
  /** Prefix of the resource URLs the cache records; relative by default, since a cache that
   *  names the machine it was built on is refused (`self-contained-repository.test.ts`). */
  resourceBase?: string;
  threads?: number;
  ramMb?: number;
  simplification?: 'none' | 'qem-endpoints';
  stdio?: StdioOptions;
}

/** Compiles one full cache with the native compiler; throws when it cannot start or fails. */
export function compileFullCache({
  cwd,
  source,
  cache = 'cache',
  resourceBase = '../../../../source/',
  threads = 2,
  ramMb = 256,
  simplification = 'none',
  stdio = 'inherit',
}: FullCompile) {
  const result = spawnSync(
    nativeCompiler(),
    [
      source,
      cache,
      'full',
      TRIANGLE_BUDGET,
      String(threads),
      String(ramMb),
      resourceBase,
      simplification,
    ],
    { cwd, stdio },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`The native compiler failed on ${source} (status ${result.status}).`);
}
