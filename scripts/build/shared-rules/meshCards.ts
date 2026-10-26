// The constants of a mesh's cards product, written once in TypeScript
// (`packages/sdk-core/src/contracts/meshCardsAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the file's name, its magic and version, its records and its
// flags.
import * as cards from '../../../packages/sdk-core/src/contracts/meshCardsAbi.ts'
import { header } from './statements.ts'

/** The mesh cards' shared constants, `card_representation/abi.rs`. */
export function meshCardsAbiRust() {
  return `${header(['packages/sdk-core/src/contracts/meshCardsAbi.ts'], '//!')}

/// The file, the magic, the version, the records, the flags and the directions of \`meshCards.bin\`.
pub const MESH_CARDS_FILE: &str = ${JSON.stringify(cards.MESH_CARDS_FILE)};
pub const MESH_CARDS_MAGIC: u32 = ${cards.MESH_CARDS_MAGIC};
pub const MESH_CARDS_VERSION: u32 = ${cards.MESH_CARDS_VERSION};
pub const MESH_CARDS_HEAD_BYTES: usize = ${cards.MESH_CARDS_HEAD_BYTES};
pub const MESH_CARDS_MESH_BYTES: usize = ${cards.MESH_CARDS_MESH_BYTES};
pub const MESH_CARDS_CARD_BYTES: usize = ${cards.MESH_CARDS_CARD_BYTES};
pub const MESH_CARDS_FLAG_TWO_SIDED: u32 = ${cards.MESH_CARDS_FLAG_TWO_SIDED};
pub const MESH_CARDS_FLAG_HLOD_CELL: u32 = ${cards.MESH_CARDS_FLAG_HLOD_CELL};
pub const MESH_CARDS_DIRECTIONS: usize = ${cards.MESH_CARDS_DIRECTIONS};
`
}
