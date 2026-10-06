#!/usr/bin/env node
import { prepare, createTerminalProgress } from '../index.mts'
import { compilerError, describeMessage, messageOf } from '../messages/catalogue.mts'
import { messageTally } from './messageTally.mts'

/** Exit code of `--strict` when the compile succeeded with warnings; failures exit 1. */
const STRICT_EXIT = 3
const FLAGS = new Set(['--strict', '--verbose'])
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const [
  input,
  output,
  scope = 'slice',
  budget = '150000',
  resourceBaseUrl,
  threads = '2',
  ramBudgetMb = '256',
  simplification = 'none',
] = argv.filter((arg) => !arg.startsWith('--'))
const triangleBudget = Number(budget)
const unknown = [...flags].filter((flag) => !FLAGS.has(flag))
if (!input || !output || !resourceBaseUrl || unknown.length)
  throw compilerError(
    'INVALID_ARGS',
    'usage: trillion3d-compile [--strict] [--verbose] SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL [threads] [RAM_MB] [none|qem-endpoints]',
  )
if (scope !== 'slice' && scope !== 'full')
  throw compilerError('INVALID_OPTIONS', 'scope must be slice or full')
if (!Number.isSafeInteger(triangleBudget) || triangleBudget < 1)
  throw compilerError('INVALID_OPTIONS', 'triangle-budget must be a positive integer')
if (simplification !== 'none' && simplification !== 'qem-endpoints')
  throw compilerError('INVALID_OPTIONS', 'simplification must be none or qem-endpoints')
const [strict, verbose] = [flags.has('--strict'), flags.has('--verbose')]
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
// A terminal gets a live bar and a short summary; a pipe (CI, another program) gets the raw JSON
// events, then the same summary as JSON events.
const raw = !process.stderr.isTTY || Boolean(process.env.TRILLION3D_RAW_EVENTS)
const progress = raw ? null : createTerminalProgress({ label: input, verbose })
const messages = messageTally(verbose)
const write = (value: unknown) => process.stderr.write(`${JSON.stringify(value)}\n`)
const result = await prepare(input, output, scope, triangleBudget, {
  executable: process.env.TRILLION3D_COMPILER_BIN,
  resourceBaseUrl,
  threads: Number(threads),
  ramBudgetMb: Number(ramBudgetMb),
  simplification,
  signal: controller.signal,
  onProgress: (event) => {
    messages.record(event)
    if (progress) progress.event(event)
    else write(event)
  },
}).catch((error: unknown) => {
  progress?.fail(error instanceof Error ? error.message : String(error))
  throw error
})
// The terminal progress told its summary when the job completed; a pipe gets it as events.
if (raw) messages.events('job').forEach(write)
const {
  status,
  key,
  scope: resultScope,
  url,
  pointer,
  cache,
  selectedTriangles,
  sourceTriangles,
  metrics,
  unsupported,
} = result
process.stdout.write(
  `${JSON.stringify({ status, key, scope: resultScope, url, pointer, cache, selectedTriangles, sourceTriangles, metrics, unsupported })}\n`,
)
const count = messages.warnings
if (strict && count > 0) {
  if (raw) write({ event: 'error', job: 'job', ...messageOf('STRICT_WARNINGS'), count })
  else process.stderr.write(`✖ ${describeMessage('STRICT_WARNINGS', `${count} warning(s)`)}\n`)
  process.exitCode = STRICT_EXIT
}
