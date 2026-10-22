#!/usr/bin/env node
import { prepare } from '../index.mts'
import { createTerminalProgress } from './progress.mts'
import { compilerError, describeMessage, messageOf } from '../messages/catalogue.mts'
import { messageTally } from './messageTally.mts'
import { ASSET_SCOPES, DEFAULT_SCOPE } from '../../../sdk-core/src/contracts/base.ts'
import {
  DEFAULT_RAM_BUDGET_MB,
  DEFAULT_SIMPLIFICATION,
  DEFAULT_TRIANGLE_BUDGET,
  HLOD_OPTION,
  MATERIALS_OPTION,
  MESH_BUILD_OPTION,
  OBJECT_SETTINGS_OPTION,
  PARTITION_GRID_OPTION,
  PARTITION_GRIDS_OPTION,
  RESPONSIVE_OPTION,
  SIMPLIFICATIONS,
  TEMPORAL_AA_LEVELS,
  TEMPORAL_AA_OPTION,
  VOXELIZE_OPTION,
} from '../../../sdk-core/src/contracts/compilerAbi.ts'
import type { TemporalAntialiasingOption } from '../../../sdk-core/src/contracts/materialOptions.ts'
import {
  PARTITION_SCHEME_OPTION,
  PARTITION_SCHEMES,
  type PartitionSchemeOption,
} from '../../../sdk-core/src/contracts/partitionOptions.ts'
import type { PrepareOptions } from '../compiler/contracts.ts'

/** Exit code of `--strict` when the compile succeeded with warnings; failures exit 1. */
const STRICT_EXIT = 3
const FLAGS = new Set(['--strict', '--verbose'])
const argv = process.argv.slice(2)
// The flags holding a value, each the last one. Those holding JSON, by the job field they set: the
// HLOD, either form (`resolveHlod`), the responsive objects (`resolveResponsive`), the settings by
// material name (`resolveMaterials`), the voxelized objects (`resolveVoxelize`), the partition's
// main grid (`resolvePartitionGrid`) or its several grids (`resolvePartitionGrids`), the mesh build
// settings (`resolveMeshBuild`) and the object settings (`resolveObjectSettings`).
const JSON_FLAGS = {
  hlod: HLOD_OPTION,
  responsive: RESPONSIVE_OPTION,
  materials: MATERIALS_OPTION,
  voxelize: VOXELIZE_OPTION,
  partitionGrid: PARTITION_GRID_OPTION,
  partitionGrids: PARTITION_GRIDS_OPTION,
  meshBuild: MESH_BUILD_OPTION,
  objectSettings: OBJECT_SETTINGS_OPTION,
} as const
// And those holding a bare word: the scene's temporal anti-aliasing (`resolveTemporalAntialiasing`,
// a level or a boolean) and the partition's scheme (`resolvePartitionScheme`, a name or `true`).
const VALUE_FLAGS = [...Object.values(JSON_FLAGS), TEMPORAL_AA_OPTION, PARTITION_SCHEME_OPTION]
const isValueFlag = (arg: string) => VALUE_FLAGS.some((option) => arg.startsWith(option))
const flags = new Set(argv.filter((arg) => arg.startsWith('--') && !isValueFlag(arg)))
const [
  input,
  output,
  scope = DEFAULT_SCOPE,
  budget = String(DEFAULT_TRIANGLE_BUDGET),
  resourceBaseUrl,
  threads,
  ramBudgetMb = String(DEFAULT_RAM_BUDGET_MB),
  simplification = DEFAULT_SIMPLIFICATION,
] = argv.filter((arg) => !arg.startsWith('--'))
const triangleBudget = Number(budget)
const unknown = [...flags].filter((flag) => !FLAGS.has(flag))
if (!input || !output || !resourceBaseUrl || unknown.length)
  throw compilerError(
    'INVALID_ARGS',
    `usage: trillion3d-compile [--strict] [--verbose] [${HLOD_OPTION}JSON] [${TEMPORAL_AA_OPTION}${TEMPORAL_AA_LEVELS.join('|')}|true|false] [${RESPONSIVE_OPTION}JSON] [${MATERIALS_OPTION}JSON] [${VOXELIZE_OPTION}JSON] [${PARTITION_SCHEME_OPTION}${PARTITION_SCHEMES.join('|')}|true] [${PARTITION_GRID_OPTION}JSON] [${PARTITION_GRIDS_OPTION}JSON] [${MESH_BUILD_OPTION}JSON] [${OBJECT_SETTINGS_OPTION}JSON] SOURCE CACHE [${ASSET_SCOPES.join('|')}] [triangleBudget] RESOURCE_BASE_URL [threads] [ramBudgetMb] [${SIMPLIFICATIONS.join('|')}]`,
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
/** The JSON the last `option` flag holds, none without one. */
function jsonFlag<T>(option: string): T | undefined {
  const flag = argv.filter((arg) => arg.startsWith(option)).pop()
  if (flag === undefined) return undefined
  try {
    return JSON.parse(flag.slice(option.length)) as T
  } catch {
    throw compilerError('INVALID_OPTIONS', `${option} must hold JSON`)
  }
}
const jsonOptions = Object.fromEntries(
  Object.entries(JSON_FLAGS).map(([field, option]) => [field, jsonFlag(option)]),
) as Pick<PrepareOptions, keyof typeof JSON_FLAGS>
/** The last `--temporal-antialiasing=` flag's level: `true` and `false` as booleans, any other
 *  word as itself, which `resolveTemporalAntialiasing` checks. */
const levelFlag = argv.filter((arg) => arg.startsWith(TEMPORAL_AA_OPTION)).pop()
const levelWord = levelFlag?.slice(TEMPORAL_AA_OPTION.length)
const temporalAntialiasing =
  levelWord === 'true'
    ? true
    : levelWord === 'false'
      ? false
      : (levelWord as TemporalAntialiasingOption | undefined)
/** The last `--partition-scheme=` flag's word: `true` as the boolean, any other word as itself,
 *  which `resolvePartitionScheme` checks. */
const schemeWord = argv
  .filter((arg) => arg.startsWith(PARTITION_SCHEME_OPTION))
  .pop()
  ?.slice(PARTITION_SCHEME_OPTION.length)
const partitionScheme =
  schemeWord === 'true' ? true : (schemeWord as PartitionSchemeOption | undefined)
const [strict, verbose] = [flags.has('--strict'), flags.has('--verbose')]
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
// A terminal gets a live bar and a short summary; a pipe (CI, another program) gets the raw JSON
// events, then the same summary as JSON events.
const raw = !process.stderr.isTTY || Boolean(process.env.TRILLION3D_RAW_EVENTS)
// One tally of the messages: the terminal progress's, or the pipe's own.
const progress = raw ? null : createTerminalProgress({ label: input, verbose })
const messages = raw ? messageTally(verbose) : null
const write = (value: unknown) => process.stderr.write(`${JSON.stringify(value)}\n`)
const result = await prepare(input, output, scope, triangleBudget, {
  executable: process.env.TRILLION3D_COMPILER_BIN,
  resourceBaseUrl,
  threads: threads === undefined ? undefined : Number(threads),
  ramBudgetMb: Number(ramBudgetMb),
  simplification,
  ...jsonOptions,
  temporalAntialiasing,
  partitionScheme,
  signal: controller.signal,
  onProgress: (event) => {
    if (progress) progress.event(event)
    else {
      messages!.record(event)
      write(event)
    }
  },
}).catch((error: unknown) => {
  progress?.fail(error instanceof Error ? error.message : String(error))
  throw error
})
// The terminal progress told its summary when the job completed; a pipe gets it as events.
messages?.events('job').forEach(write)
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
const count = (progress ?? messages!).warnings
if (strict && count > 0) {
  if (raw) write({ event: 'error', job: 'job', ...messageOf('STRICT_WARNINGS'), count })
  else process.stderr.write(`✖ ${describeMessage('STRICT_WARNINGS', `${count} warning(s)`)}\n`)
  process.exitCode = STRICT_EXIT
}
