// The values the compiler, the runtime and the physics module state in more than one language,
// written once in TypeScript and printed into the others (`../generate-shared-rules.ts`): the
// cache formats and compiler defaults into the compiler's Rust, and the public code of the family refusal into
// the browser's TypeScript.
import { join } from 'node:path'
import {
  ASSET_SCOPES,
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
} from '../../packages/sdk-core/src/contracts/base.ts'
import * as compiler from '../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { REPOSITORY_ROOT, readJson } from '../repository-files.ts'
import { header } from './statements.ts'

const CATALOGUE = 'packages/sdk-node/src/messages/messages.json'

/** A Rust array of the strings `words`. */
const strings = (words: readonly string[]) =>
  `[&str; ${words.length}] = [${words.map((word) => JSON.stringify(word)).join(', ')}]`
/** A job field's Rust constant: `triangleBudget` is `TRIANGLE_BUDGET`. */
const fieldConstant = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()

/** The compiler's shared constants, `shared_math/abi.rs`. */
export function compilerAbiRust() {
  return `${header(
    ['packages/sdk-core/src/contracts/base.ts', 'packages/sdk-core/src/contracts/compilerAbi.ts'],
    '//!',
  )}

/// Cache format this compiler writes (\`base.ts\` documents each format's change).
pub const FORMAT_VERSION: u32 = ${FORMAT_VERSION};
/// Outer cache format required for clustered BLEND.
pub const CLUSTERED_BLEND_FORMAT_VERSION: u32 = ${CLUSTERED_BLEND_FORMAT_VERSION};
/// The triangle budget of a compilation that names none.
pub const DEFAULT_TRIANGLE_BUDGET: usize = ${compiler.DEFAULT_TRIANGLE_BUDGET};
/// The threads of a compilation that names none.
pub const DEFAULT_THREADS: usize = ${compiler.DEFAULT_THREADS};
/// The memory, in MB, of a compilation that names none.
pub const DEFAULT_RAM_BUDGET_MB: usize = ${compiler.DEFAULT_RAM_BUDGET_MB};
/// The most threads one job may use.
pub const MAX_THREADS: usize = ${compiler.MAX_THREADS};
/// The least memory, in MB, one job needs to decode the smallest scene.
pub const MIN_RAM_BUDGET_MB: usize = ${compiler.MIN_RAM_BUDGET_MB};
/// The scopes a job may name.
pub const SCOPES: ${strings(ASSET_SCOPES)};
/// How meshes may be simplified; the first is the default.
pub const SIMPLIFICATIONS: ${strings(compiler.SIMPLIFICATIONS)};
/// The fields of one compile job, as a batch file names them.
pub mod job_field {
${compiler.JOB_FIELDS.map((field) => `    pub const ${fieldConstant(field)}: &str = ${JSON.stringify(field)};`).join('\n')}
}
/// The job fields in the order the command line takes them; its short forms leave out
/// \`simplification\`, then \`threads\` and \`ramBudgetMb\`.
pub const JOB_FIELDS: [&str; ${compiler.JOB_FIELDS.length}] = [${compiler.JOB_FIELDS.map((field) => `job_field::${fieldConstant(field)}`).join(', ')}];
`
}

/** The public code of the family refusal, read from the message catalogue. */
export function familyLoadFailedId() {
  const entry = (
    readJson(join(REPOSITORY_ROOT, CATALOGUE)) as {
      messages: { id: string; code: string }[]
    }
  ).messages.find((message) => message.code === 'FAMILY_LOAD_FAILED')
  if (!entry) throw new Error('the message catalogue has no FAMILY_LOAD_FAILED')
  return `${header([CATALOGUE], '//')}

/** The public code of a family that could not load (\`FAMILY_LOAD_FAILED\` in the message catalogue). */
export const FAMILY_LOAD_FAILED_ID = '${entry.id}'
`
}
