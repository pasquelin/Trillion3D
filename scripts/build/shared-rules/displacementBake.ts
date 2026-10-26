// The constants of a mesh's baked displacement, written once in TypeScript
// (`packages/sdk-core/src/contracts/displacementBakeAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the settings' names and defaults, the keys of a height map and of
// its texture, the largest map and the ways to share an added vertex.
import * as bake from '../../../packages/sdk-core/src/contracts/displacementBakeAbi.ts'
import { header, rustStrings } from './statements.ts'

/** The baked displacement's shared constants, `displace/abi.rs`. */
export function displacementBakeAbiRust() {
  const rules = bake.DISPLACEMENT_BAKE_RULES
  return `${header(['packages/sdk-core/src/contracts/displacementBakeAbi.ts'], '//!')}

/// The mesh build settings of a baked displacement (\`meshBuild\`) and their defaults, the reference's.
pub const DISPLACEMENT_MAPS_SETTING: &str = ${JSON.stringify(bake.DISPLACEMENT_MAPS_SETTING)};
pub const DISPLACEMENT_UV_CHANNEL_SETTING: &str = ${JSON.stringify(rules.displacementUvChannel.field)};
pub const DISPLACEMENT_EDGE_SPLIT_SETTING: &str = ${JSON.stringify(rules.displacementEdgeSplit.field)};
pub const DEFAULT_DISPLACEMENT_UV_CHANNEL: usize = ${rules.displacementUvChannel.default};
pub const MAX_DISPLACEMENT_UV_CHANNEL: i64 = ${bake.MAX_DISPLACEMENT_UV_CHANNEL};
/// The keys of a height map, its defaults, and the most texels a side of one holds.
pub const DISPLACEMENT_MAP_KEYS: ${rustStrings(bake.DISPLACEMENT_MAP_KEYS)};
/// The only key of a height map's \`texture\`: the set it is read at is the settings' alone.
pub const DISPLACEMENT_TEXTURE_KEYS: ${rustStrings(bake.DISPLACEMENT_TEXTURE_KEYS)};
pub const DEFAULT_DISPLACEMENT_MAP_MAGNITUDE: f64 = ${bake.DEFAULT_DISPLACEMENT_MAP_MAGNITUDE.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_MAP_CENTER: f64 = ${bake.DEFAULT_DISPLACEMENT_MAP_CENTER.toFixed(1)};
pub const MAX_DISPLACEMENT_MAP_SIZE: usize = ${bake.MAX_DISPLACEMENT_MAP_SIZE};
/// How the tessellation shares the vertex it adds on an edge.
pub const DISPLACEMENT_EDGE_SPLITS: ${rustStrings(bake.DISPLACEMENT_EDGE_SPLITS)};
`
}
