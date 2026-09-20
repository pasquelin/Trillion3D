import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompiler } from './compilerProcess.mts';
export {
  COMPILER_LINE_LIMIT,
  CANCEL_GRACE_MS,
  resolveCompilerExecutable,
} from './compilerProcess.mts';
export { getSdkProvenance } from './provenance.mts';
import { DEFAULT_SCOPE } from '../sdk-core/index.ts';
import type { AssetScope } from '../sdk-core/index.ts';
import type {
  BatchJob,
  BatchOptions,
  BatchSummary,
  CompilationJob,
  CompilationJobOptions,
  CompilationPointer,
  CompilationResult,
  PrepareOptions,
} from './contracts.ts';
export { DEFAULT_SCOPE };
export type {
  BatchJob,
  BatchOptions,
  BatchOutcome,
  BatchSummary,
  CompilationJob,
  CompilationJobOptions,
  CompilationPointer,
  CompilationResult,
  CompilationSummary,
  CompilerEvent,
  CutoutModel,
  CutoutReviewOptions,
  CutoutReviewSummary,
  PrepareOptions,
  ProgressPointer,
  ProgressStream,
  TerminalProgress,
  TerminalProgressOptions,
} from './contracts.ts';
export { createTerminalProgress, createBatchProgress } from './progress.mts';
export { reviewCutouts } from './cutoutReview.mts';
/** Native is the production path. The host supplies an executable explicitly or through the environment. */
export async function prepare(
  input: string,
  output: string,
  scope: AssetScope = DEFAULT_SCOPE,
  budget = 150000,
  options?: PrepareOptions,
): Promise<CompilationResult> {
  if (typeof options?.resourceBaseUrl !== 'string' || !options.resourceBaseUrl)
    throw new Error('resourceBaseUrl is required');
  const args = [
    input,
    output,
    scope,
    String(budget),
    String(options.threads ?? 2),
    String(options.ramBudgetMb ?? 256),
    options.resourceBaseUrl,
    options.simplification ?? 'none',
  ];
  const pointer = await runCompiler<CompilationPointer | { status: 'error'; code?: string }>(
    args,
    options,
    options.onProgress,
  );
  if (pointer.status !== 'ready') throw new Error(pointer.code ?? 'COMPILER_NOT_READY');
  const manifest = JSON.parse(
    await readFile(join(output, 'native', pointer.scope, pointer.url), 'utf8'),
  ) as CompilationResult;
  return {
    ...manifest,
    metrics: withFinalMetrics(manifest, pointer),
    url: pointer.url,
    pointer: pointer.pointer,
    cache: pointer.cache,
    reused: pointer.reused ?? null,
  };
}
/**
 * The manifest is serialized before the cache is pruned, so it cannot hold what comes after it —
 * the purge and the job's own duration. Those live on the pointer alone, and a caller that only
 * reads the returned result would otherwise never see them. The manifest stays authoritative for
 * every measurement it does carry: it is spread last, so it wins over the pointer, which
 * only fills in the keys it leaves out.
 */
function withFinalMetrics(manifest: CompilationResult, pointer: CompilationPointer) {
  return { ...pointer.metrics, ...(manifest.metrics as Record<string, unknown> | undefined) };
}
/**
 * Prepares many models in one compiler process. `jobs` entries: {id, source, cache, scope, triangles,
 * resourceBaseUrl, simplification, threads, ramBudgetMb}. The compiler runs `workers` jobs at a time and
 * splits `ramBudgetMb` between them. Resolves with the batch summary (pointers only, nothing read from disk).
 */
export async function prepareMany(
  jobs: BatchJob[],
  options: BatchOptions = {},
): Promise<BatchSummary> {
  if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('jobs must be a non-empty array');
  for (const job of jobs) {
    if (typeof job.resourceBaseUrl !== 'string' || !job.resourceBaseUrl)
      throw new Error(`job ${job.id ?? '?'}: resourceBaseUrl is required`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'web-geometry-batch-'));
  try {
    const file = join(directory, 'jobs.json');
    await writeFile(
      file,
      JSON.stringify({
        workers: options.workers ?? 1,
        ramBudgetMb: options.ramBudgetMb,
        threads: options.threads,
        jobs,
      }),
    );
    const summary = await runCompiler<BatchSummary | { status: 'error'; code?: string }>(
      ['--jobs', file],
      options,
      options.onEvent,
    );
    if (summary.status === 'error') throw new Error(summary.code ?? 'INVALID_BATCH');
    return summary;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Host-visible job lifecycle; abort forwards to the native subprocess. */
export async function createCompilationJob(
  id: string,
  input: string,
  output: string,
  options: CompilationJobOptions,
): Promise<CompilationJob> {
  const { createJob } = await import('../sdk-core/index.ts');
  return createJob(
    id,
    ({ signal, progress }) =>
      prepare(input, output, options.scope ?? DEFAULT_SCOPE, options.triangleBudget ?? 150000, {
        ...options,
        signal,
        onProgress: (event) => progress({ ...event, phase: event.phase ?? event.event }),
      }),
    { signal: options.signal, telemetry: options.telemetry },
  );
}
