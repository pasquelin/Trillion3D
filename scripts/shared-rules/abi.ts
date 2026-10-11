// The values the compiler, the runtime and the physics module state in more than one language,
// written once in TypeScript and printed into the others (`../generate-shared-rules.ts`): the
// cache formats and the cluster limits and compiler defaults into the compiler's Rust, the packed
// animation tracks' layout into the sampler's Rust, and the public code of the family refusal into
// the browser's TypeScript.
import { join } from 'node:path'
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
} from '../../packages/sdk-core/src/contracts/base.ts'
import * as compiler from '../../packages/sdk-core/src/contracts/compilerAbi.ts'
import * as track from '../../packages/sdk-browser/src/animation/trackLayout.ts'
import { REPOSITORY_ROOT, readJson } from '../repository-files.ts'
import { header } from './statements.ts'

const CATALOGUE = 'packages/sdk-node/src/messages/messages.json'

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
/// Triangles per cluster. Matches the page budget used by the exact path.
pub const DAG_CLUSTER_TRIANGLES: usize = ${compiler.DAG_CLUSTER_TRIANGLES};
/// Vertex limit of a cluster; a 128 triangle cluster never needs more.
pub const DAG_CLUSTER_VERTICES: usize = ${compiler.DAG_CLUSTER_VERTICES};
/// The triangle budget of a compilation that names none.
pub const DEFAULT_TRIANGLE_BUDGET: usize = ${compiler.DEFAULT_TRIANGLE_BUDGET};
/// The threads of a compilation that names none.
pub const DEFAULT_THREADS: usize = ${compiler.DEFAULT_THREADS};
/// The memory, in MB, of a compilation that names none.
pub const DEFAULT_RAM_BUDGET_MB: usize = ${compiler.DEFAULT_RAM_BUDGET_MB};
`
}

/** The animation sampler's track layout, `anim_layout.rs`. */
export function animationLayoutRust() {
  return `${header(['packages/sdk-browser/src/animation/trackLayout.ts'], '//!')}

/// Words describing one track.
pub const TRACK_WORDS: usize = ${track.TRACK_WORDS};
/// Numbers of one track's arc: the key it starts at (−1: none yet), its side, angle and sine.
pub const ARC_VALUES: usize = ${track.ARC_VALUES};
/// Kind bit: the track holds rotations.
pub const QUATERNION: u32 = ${track.QUATERNION};
/// Interpolation, in the kind's bits above the first: the earlier key.
pub const STEP: u32 = ${track.STEP};
/// Interpolation, in the kind's bits above the first: glTF's spline.
pub const CUBIC: u32 = ${track.CUBIC};
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
