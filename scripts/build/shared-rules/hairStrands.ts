// The constants of the hair strands product, written once in TypeScript
// (`packages/sdk-core/src/contracts/hairStrandsAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the job field and flag of the ending point, the file's name, its magic and version, its records and the
// rank of each of their words, the tables' alignment, the flags, the attributes and the limits. The bytes of a table's entry
// are the strands loader's alone: the compiler writes the tables whole.
import * as hair from '../../../packages/sdk-core/src/contracts/hairStrandsAbi.ts'
import { upper } from './printer.ts'
import { header, rustConsts } from './statements.ts'

/** The rank of each word of a group's record, as `HAIR_STRANDS_AT_` and its name in capitals. */
const groupWords = Object.fromEntries(
  Object.entries(hair.HAIR_STRANDS_GROUP_AT).map(([name, at]) => [
    `HAIR_STRANDS_AT_${upper(name)}`,
    [at, 'usize'] as const,
  ]),
)

/** The hair strands product's shared constants, `hair_strands/abi.rs`. */
export function hairStrandsAbiRust() {
  return `${header(['packages/sdk-core/src/contracts/hairStrandsAbi.ts'], '//!')}

/// The job field and flag of the ending point, the file, the magic, the version, the records and the rank of each of their words, the tables' alignment, the flags, the attributes and the limits of \`hairStrands.bin\`.
${rustConsts({
  HAIR_STRANDS_ENDING_POINT_FIELD: [hair.HAIR_STRANDS_ENDING_POINT_FIELD, '&str'],
  HAIR_STRANDS_ENDING_POINT_OPTION: [hair.HAIR_STRANDS_ENDING_POINT_OPTION, '&str'],
  HAIR_STRANDS_FILE: [hair.HAIR_STRANDS_FILE, '&str'],
  HAIR_STRANDS_MAGIC: [hair.HAIR_STRANDS_MAGIC, 'u32'],
  HAIR_STRANDS_VERSION: [hair.HAIR_STRANDS_VERSION, 'u32'],
  HAIR_STRANDS_HEAD_BYTES: [hair.HAIR_STRANDS_HEAD_BYTES, 'usize'],
  HAIR_STRANDS_GROUP_BYTES: [hair.HAIR_STRANDS_GROUP_BYTES, 'usize'],
  HAIR_STRANDS_GROUP_WORDS: [hair.HAIR_STRANDS_GROUP_WORDS, 'usize'],
  ...groupWords,
  HAIR_STRANDS_POINT_BYTES: [hair.HAIR_STRANDS_POINT_BYTES, 'usize'],
  HAIR_STRANDS_POINTS_ALIGNMENT: [hair.HAIR_STRANDS_POINTS_ALIGNMENT, 'usize'],
  HAIR_STRANDS_TABLE_ALIGNMENT: [hair.HAIR_STRANDS_TABLE_ALIGNMENT, 'usize'],
  HAIR_STRANDS_FLAG_TRIMMED_POINT: [hair.HAIR_STRANDS_FLAG_TRIMMED_POINT, 'u32'],
  HAIR_STRANDS_FLAG_TRIMMED_CURVE: [hair.HAIR_STRANDS_FLAG_TRIMMED_CURVE, 'u32'],
  HAIR_STRANDS_FLAG_INVALID_POINT: [hair.HAIR_STRANDS_FLAG_INVALID_POINT, 'u32'],
  HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT: [hair.HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT, 'u32'],
  HAIR_STRANDS_FLAG_SHUFFLED_CURVE: [hair.HAIR_STRANDS_FLAG_SHUFFLED_CURVE, 'u32'],
  HAIR_STRANDS_FLAG_ROOT_TILE: [hair.HAIR_STRANDS_FLAG_ROOT_TILE, 'u32'],
  HAIR_STRANDS_ATTRIBUTE_ROOT_UV: [hair.HAIR_STRANDS_ATTRIBUTE_ROOT_UV, 'u32'],
  HAIR_STRANDS_ATTRIBUTE_COLOR: [hair.HAIR_STRANDS_ATTRIBUTE_COLOR, 'u32'],
  HAIR_STRANDS_ATTRIBUTE_ROUGHNESS: [hair.HAIR_STRANDS_ATTRIBUTE_ROUGHNESS, 'u32'],
  HAIR_STRANDS_CONTROL_POINT_INSIDE: [hair.HAIR_STRANDS_CONTROL_POINT_INSIDE, 'u8'],
  HAIR_STRANDS_CONTROL_POINT_START: [hair.HAIR_STRANDS_CONTROL_POINT_START, 'u8'],
  HAIR_STRANDS_CONTROL_POINT_END: [hair.HAIR_STRANDS_CONTROL_POINT_END, 'u8'],
  HAIR_STRANDS_MAX_POINTS_PER_CURVE: [hair.HAIR_STRANDS_MAX_POINTS_PER_CURVE, 'usize'],
  HAIR_STRANDS_MAX_CURVES_PER_GROUP: [hair.HAIR_STRANDS_MAX_CURVES_PER_GROUP, 'usize'],
  HAIR_STRANDS_MAX_POINTS_PER_GROUP: [hair.HAIR_STRANDS_MAX_POINTS_PER_GROUP, 'usize'],
})}
`
}
