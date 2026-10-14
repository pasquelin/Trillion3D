#!/usr/bin/env node
import { prepare } from '../index.mts'
import { createTerminalProgress } from './progress.mts'
import { compilerError, describeMessage, messageOf } from '../messages/catalogue.mts'
import { messageTally } from './messageTally.mts'
import { ASSET_SCOPES, DEFAULT_SCOPE } from '../../../sdk-core/src/contracts/base.ts'
import {
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_SIMPLIFICATION,
  DEFAULT_THREADS,
  DEFAULT_TRIANGLE_BUDGET,
  SIMPLIFICATIONS,
} from '../../../sdk-core/src/contracts/compilerAbi.ts'

/** Exit code of `--strict` when the compile succeeded with warnings; failures exit 1. */
const STRICT_EXIT = 3
const FLAGS = new Set(['--strict', '--verbose'])
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const [
  input,
  output,
  scope = DEFAULT_SCOPE,
  budget = String(DEFAULT_TRIANGLE_BUDGET),
  resourceBaseUrl,
  threads = String(DEFAULT_THREADS),
  ramBudgetMb = String(DEFAULT_RAM_BUDGET_MB),
  simplification = DEFAULT_SIMPLIFICATION,
] = argv.filter((arg) => !arg.startsWith('--'))
const triangleBudget = Number(budget)
const unknown = [...flags].filter((flag) => !FLAGS.has(flag))
if (!input || !output || !resourceBaseUrl || unknown.length)
  throw compilerError(
    'INVALID_ARGS',
    `usage: trillion3d-compile [--strict] [--verbose] SOURCE CACHE [${ASSET_SCOPES.join('|')}] [triangleBudget] RESOURCE_BASE_URL [threads] [ramBudgetMb] [${SIMPLIFICATIONS.join('|')}]`,
  )
/** Whether `word` is one of `list`'s words. */
const oneOf = <T extends string>(list: readonly T[], word: string): word is T =>
  (list as readonly string[]).includes(word)
if (!oneOf(ASSET_SCOPES, scope))
  throw compilerError('INVALID_OPTIONS', `scope must be ${ASSET_SCOPES.join(' or ')}`)
if (!Number.isSafeInteger(triangleBudget) || triangleBudget < 1)
  throw compilerError('INVALID_OPTIONS', 'triangleBudget must be a positive integer')
if (!oneOf(SIMPLIFICATIONS, simplification))
  throw compilerError('INVALID_OPTIONS', `simplification must be ${SIMPLIFICATIONS.join(' or ')}`)
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
