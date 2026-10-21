import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCompiler } from './compiler/process.mts'
export { CANCEL_GRACE_MS } from './compiler/process.mts'
export { resolveCompilerExecutable } from './compiler/executable.mts'
export { COMPILER_LINE_LIMIT } from './compiler/lines.mts'
export { getSdkProvenance } from './compiler/provenance.mts'
import { DEFAULT_SCOPE } from '../../sdk-core/src/contracts/base.ts'
import { readCompiledManifest } from './compiler/manifest.mts'
import type { AssetScope } from '../../sdk-core/src/contracts/base.ts'
import type {
  BatchJob,
  BatchOptions,
  BatchOutcome,
  BatchSummary,
  CompilationJob,
  CompilationJobOptions,
  CompilationPointer,
  CompilationResult,
  PrepareOptions,
} from './compiler/contracts.ts'
import { compilerError } from './messages/catalogue.mts'
/** What the compiler prints on stdout when it refuses a job or a batch. */
type CompilerRefusal = { status: 'error'; code?: string; message?: string }
export { DEFAULT_SCOPE }
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
  ReusedFolder,
  TerminalProgress,
  TerminalProgressOptions,
} from './compiler/contracts.ts'
import {
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_SIMPLIFICATION,
  DEFAULT_TRIANGLE_BUDGET,
  type JobField,
} from '../../sdk-core/src/contracts/compilerAbi.ts'
import { resolveHlod } from '../../sdk-core/src/contracts/hlodOptions.ts'
import { jobOptionFields } from '../../sdk-core/src/contracts/jobOptions.ts'
import { compilerArguments } from './compiler/arguments.mts'
export { resolveVoxelize } from '../../sdk-core/src/contracts/voxelizeOptions.ts'
export type { VoxelizeOption } from '../../sdk-core/src/contracts/voxelizeOptions.ts'
export {
  resolvePartitionGrid,
  resolvePartitionScheme,
} from '../../sdk-core/src/contracts/partitionOptions.ts'
export type {
  PartitionGridOption,
  PartitionGridSettings,
  PartitionGridWire,
  PartitionHlodGrid,
  PartitionSchemeOption,
} from '../../sdk-core/src/contracts/partitionOptions.ts'
export { resolveMeshBuild } from '../../sdk-core/src/contracts/meshBuildOptions.ts'
export type {
  MeshBuildOption,
  MeshBuildRule,
  MeshBuildSettings,
} from '../../sdk-core/src/contracts/meshBuildOptions.ts'
export { resolveObjectSettings } from '../../sdk-core/src/contracts/objectOptions.ts'
export type {
  ObjectRule,
  ObjectSettings,
  ObjectSettingsOption,
  SkinnedInstanceOption,
  SkinnedInstanceSettings,
} from '../../sdk-core/src/contracts/objectOptions.ts'
export {
  resolveMaterials,
  resolveResponsive,
  resolveTemporalAntialiasing,
  temporalAntialiasingShare,
} from '../../sdk-core/src/contracts/materialOptions.ts'
export type {
  MaterialSettings,
  MaterialsOption,
  ResponsiveOption,
  TemporalAntialiasingOption,
  TemporalAntialiasingShare,
} from '../../sdk-core/src/contracts/materialOptions.ts'
export type { TemporalAntialiasingLevel } from '../../sdk-core/src/contracts/compilerAbi.ts'
export { resolveHlod } from '../../sdk-core/src/contracts/hlodOptions.ts'
export type {
  HlodExpert,
  HlodGroup,
  HlodMatch,
  HlodOptions,
  HlodPattern,
  HlodSimple,
} from '../../sdk-core/src/contracts/hlodOptions.ts'
export type { HlodBuilder, HlodLayer } from '../../sdk-core/src/contracts/compilerAbi.ts'
// The wire forms a job's options are written in, named where the resolvers' signatures carry them.
export type {
  HlodApproximation,
  HlodExpertOf,
  HlodMatchOf,
  HlodMeshBuildWire,
  HlodSimplifySettings,
  HlodWire,
  HlodWireMatch,
  HlodWirePattern,
  MaterialSettingsWire,
  MeshBuildSettingsWire,
  MeshBuildWire,
  MeshInputSettingsWire,
  ObjectSettingsJobWire,
  ObjectSettingsWire,
  SkinnedInstanceWire,
} from '../../sdk-core/src/contracts/compilerAbi.ts'
export type { NameMatch, NamePattern } from '../../sdk-core/src/contracts/nameMatch.ts'
export { createTerminalProgress, createBatchProgress } from './cli/progress.mts'
export { reviewCutouts } from './cutout/review.mts'
/**
 * Compiles a source model into the cache a page loads. Native is the production path: the host
 * supplies the executable explicitly or through the environment.
 * @param input - A folder with a `manifest.json` or one glTF/GLB, or a `.gltf`, `.glb`, `.fbx`, `.obj` file.
 * @param output - The cache folder; the source is never overwritten.
 * @param scope - `'slice'` streams the model in pages, `'full'` keeps it whole.
 * @param budget - How many triangles the cache may keep.
 * @param options - Where the page loads files from, and how the compiler runs.
 * @returns The manifest the compiler wrote, with what the run measured.
 */
export async function prepare(
  input: string,
  output: string,
  scope: AssetScope = DEFAULT_SCOPE,
  budget = DEFAULT_TRIANGLE_BUDGET,
  options?: PrepareOptions,
): Promise<CompilationResult> {
  if (typeof options?.resourceBaseUrl !== 'string' || !options.resourceBaseUrl)
    throw compilerError('INVALID_OPTIONS', 'resourceBaseUrl is required')
  const job: Record<JobField, string> = {
    source: input,
    cache: output,
    scope,
    triangleBudget: String(budget),
    // None named: an empty value, which the compiler reads as its own default (`machine_threads`).
    threads: options.threads === undefined ? '' : String(options.threads),
    ramBudgetMb: String(options.ramBudgetMb ?? DEFAULT_RAM_BUDGET_MB),
    resourceBaseUrl: options.resourceBaseUrl,
    simplification: options.simplification ?? DEFAULT_SIMPLIFICATION,
  }
  // The HLOD, either form, and the other options the job names, each a flag (`compilerArguments`).
  // What does not read is the job's refusal, as the compiler's.
  let args: string[]
  try {
    args = compilerArguments(job, options)
  } catch (error) {
    if (error instanceof TypeError) throw compilerError('INVALID_OPTIONS', error.message)
    throw error
  }
  const pointer = await runCompiler<CompilationPointer | CompilerRefusal>(
    args,
    options,
    options.onProgress,
  )
  if (pointer.status !== 'ready')
    throw compilerError(pointer.code ?? 'COMPILER_NOT_READY', pointer.message)
  const path = join(output, 'native', pointer.scope, pointer.url)
  const manifest = (await readCompiledManifest(path)) as unknown as CompilationResult
  return {
    ...manifest,
    // What the run measured of itself is on the pointer alone: the manifest on disk describes the
    // product, the same bytes whatever the cache held, and an older head's report is not
    // this run's.
    metrics: pointer.metrics,
    reusedPages: pointer.reusedPages ?? null,
    url: pointer.url,
    pointer: pointer.pointer,
    cache: pointer.cache,
    reused: pointer.reused ?? null,
  }
}
/**
 * Compiles many models in one compiler process. The compiler runs `workers` jobs at a time and
 * splits `ramBudgetMb` between them.
 * @param jobs - The models to compile, at least one; each names its `resourceBaseUrl`.
 * @param options - How many jobs run at once, the memory they share, and who hears the events.
 * @returns How each job ended: pointers only, nothing read back from disk.
 */
export async function prepareMany(
  jobs: BatchJob[],
  options: BatchOptions = {},
): Promise<BatchSummary> {
  if (!Array.isArray(jobs) || jobs.length === 0)
    throw compilerError('INVALID_BATCH', 'jobs must be a non-empty array')
  for (const job of jobs) {
    if (typeof job.resourceBaseUrl !== 'string' || !job.resourceBaseUrl)
      throw compilerError('INVALID_OPTIONS', `job ${job.id ?? '?'}: resourceBaseUrl is required`)
  }
  // Each job's HLOD, either form, and its temporal anti-aliasing options, as the compiler reads
  // them. A job whose options do not read is that job's refusal (`INVALID_OPTIONS`), as the
  // compiler refuses one, never the batch's: it is named as the compiler would name it.
  const refused: BatchOutcome[] = []
  const wired = jobs.flatMap((job, at) => {
    const id = job.id || `job-${at}`
    try {
      return [
        {
          ...job,
          id,
          ...(job.hlod == null ? {} : { hlod: resolveHlod(job.hlod) }),
          ...jobOptionFields(job),
        },
      ]
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      refused.push({ job: id, status: 'error', code: 'INVALID_OPTIONS', message: error.message })
      return []
    }
  })
  const summary: BatchSummary = wired.length
    ? await runBatch(wired, options)
    : { status: 'failed', completed: 0, failed: 0, cancelled: 0, jobs: [] }
  if (!refused.length) return summary
  return {
    status: summary.completed > 0 ? 'partial' : 'failed',
    completed: summary.completed,
    failed: summary.failed + refused.length,
    cancelled: summary.cancelled,
    jobs: [...summary.jobs, ...refused].sort((a, b) =>
      a.job < b.job ? -1 : a.job > b.job ? 1 : 0,
    ),
  }
}

/** Runs the batch of `jobs`, each in the compiler's form, in one compiler process. */
async function runBatch(jobs: object[], options: BatchOptions): Promise<BatchSummary> {
  const directory = await mkdtemp(join(tmpdir(), 'trillion3d-batch-'))
  try {
    const file = join(directory, 'jobs.json')
    await writeFile(
      file,
      JSON.stringify({
        workers: options.workers ?? 1,
        ramBudgetMb: options.ramBudgetMb,
        threads: options.threads,
        jobs,
      }),
    )
    const summary = await runCompiler<BatchSummary | CompilerRefusal>(
      ['--jobs', file],
      options,
      options.onEvent,
    )
    if (summary.status === 'error')
      throw compilerError(summary.code ?? 'INVALID_BATCH', summary.message)
    return summary
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
/** Host-visible job lifecycle; abort forwards to the native subprocess. */
export async function createCompilationJob(
  id: string,
  input: string,
  output: string,
  options: CompilationJobOptions,
): Promise<CompilationJob> {
  const { createJob } = await import('../../sdk-core/src/runtime/jobs/jobs.ts')
  return createJob(
    id,
    ({ signal, progress }) =>
      prepare(
        input,
        output,
        options.scope ?? DEFAULT_SCOPE,
        options.triangleBudget ?? DEFAULT_TRIANGLE_BUDGET,
        {
          ...options,
          signal,
          onProgress: (event) => progress({ ...event, phase: event.phase ?? event.event }),
        },
      ),
    { signal: options.signal, telemetry: options.telemetry },
  )
}
