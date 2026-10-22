import {
  HLOD_OPTION,
  JOB_FIELDS,
  type JobField,
} from '../../../sdk-core/src/contracts/compilerAbi.ts'
import { resolveHlod, type HlodOptions } from '../../../sdk-core/src/contracts/hlodOptions.ts'
import { jobOptionFlags, type JobOptions } from '../../../sdk-core/src/contracts/jobOptions.ts'

/** The value of every job field, `threads` a count: none named is the compiler's own default
 *  (`machine_threads`), an empty value on its command line. */
export type CompilerJob = { [Field in Exclude<JobField, 'threads'>]: string } & {
  threads?: number
}

/**
 * The compiler's command line for one job: its fields in the order `JOB_FIELDS` declares, then the
 * HLOD (either form, as `resolveHlod` writes it) and every other option the job names, each a
 * flag and none positional. The one builder, for the SDK's own compile and the repository tools'.
 * @param job - The value of every job field; an empty value, or no `threads`, is the compiler's
 *   own default.
 * @param options - The job's HLOD and the other options it names.
 * @returns The arguments to hand the compiler executable.
 * @throws TypeError when an option does not read.
 */
export function compilerArguments(
  job: CompilerJob,
  options: JobOptions & { hlod?: HlodOptions | null },
): string[] {
  const args = JOB_FIELDS.map((field) =>
    field === 'threads' ? (job.threads === undefined ? '' : String(job.threads)) : job[field],
  )
  const hlod = resolveHlod(options.hlod)
  if (hlod) args.push(`${HLOD_OPTION}${JSON.stringify(hlod)}`)
  args.push(...jobOptionFlags(options))
  return args
}
