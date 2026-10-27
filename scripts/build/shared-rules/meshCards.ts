// The constants of a mesh's cards product, written once in TypeScript
// (`packages/sdk-core/src/contracts/meshCardsAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the file's name, its magic and version, its records and its
// flags.
import * as cards from '../../../packages/sdk-core/src/contracts/meshCardsAbi.ts'
import { header, rustConsts } from './statements.ts'

/** The mesh cards' shared constants, `card_representation/abi.rs`. */
export function meshCardsAbiRust() {
  return `${header(['packages/sdk-core/src/contracts/meshCardsAbi.ts'], '//!')}

/// The file, the magic, the version, the records, the flags and the directions of \`meshCards.bin\`.
${rustConsts({
  MESH_CARDS_FILE: [cards.MESH_CARDS_FILE, '&str'],
  MESH_CARDS_MAGIC: [cards.MESH_CARDS_MAGIC, 'u32'],
  MESH_CARDS_VERSION: [cards.MESH_CARDS_VERSION, 'u32'],
  MESH_CARDS_HEAD_BYTES: [cards.MESH_CARDS_HEAD_BYTES, 'usize'],
  MESH_CARDS_MESH_BYTES: [cards.MESH_CARDS_MESH_BYTES, 'usize'],
  MESH_CARDS_CARD_BYTES: [cards.MESH_CARDS_CARD_BYTES, 'usize'],
  MESH_CARDS_FLAG_TWO_SIDED: [cards.MESH_CARDS_FLAG_TWO_SIDED, 'u32'],
  MESH_CARDS_FLAG_HLOD_CELL: [cards.MESH_CARDS_FLAG_HLOD_CELL, 'u32'],
  MESH_CARDS_DIRECTIONS: [cards.MESH_CARDS_DIRECTIONS, 'usize'],
})}
`
}
