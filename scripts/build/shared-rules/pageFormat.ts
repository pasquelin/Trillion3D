// The page format's numbers printed (`../generate-shared-rules.ts`): the Rust codec owns every
// constant of the `WGP3` page, the DAG's cluster size and the SDK module's page-encoder ABI; the
// TypeScript readers, the WGSL routines built from them and the run-time cut take them from the
// files printed here, never from a copy.
import { comment, header } from './statements.ts'
import { type RustConstant, rustConstants, rustSource } from './rust.ts'

const CODEC = 'packages/page-codec-wasm/src'

/** The codec's constants by their Rust name, the files read in an order that lets a later one name
 *  an earlier one's. */
function codec() {
  const known = new Map<string, number>()
  const read = (file: string) => rustConstants(`${CODEC}/${file}`, known)
  return {
    page: read('lib.rs'),
    bits: read('bits.rs'),
    deform: read('deform.rs'),
    triangles: read('triangles.rs'),
    dag: rustConstants('packages/asset-compiler-rust/src/dag.rs', known),
  }
}

/** The TypeScript names the readers know two of the page's constants by. */
const RENAMED: Record<string, string> = {
  MAGIC: 'GEOMETRY_PAGE_MAGIC',
  VERSION: 'GEOMETRY_PAGE_FORMAT_VERSION',
  RESIDENT_VERSION: 'GEOMETRY_PAGE_RESIDENT_VERSION',
  HEADER_WORDS: 'CLUSTER_HEADER_WORDS',
}

/** The decoded name of each optional attribute, in the order `OPTIONAL` (`attributes.rs`) lists
 *  them: the names are the readers', the flags and widths the codec's. */
const OPTIONAL_NAMES = [
  'normal',
  'uv',
  'uv1',
  'uv2',
  'uv3',
  'uv4',
  'uv5',
  'uv6',
  'uv7',
  'color',
  'tangent',
]

const exported = (constants: readonly RustConstant[], names: readonly string[]) =>
  names.map((name) => {
    const found = constants.find((constant) => constant.name === name)
    if (!found) throw new Error(`${CODEC}: no constant '${name}'`)
    return found
  })

/** The flags no reader names but through the attribute table the printed module builds (`OPTIONAL`):
 *  printed unexported, since an export no reader takes is dead code (`check:unused`). */
const TABLE_ONLY = new Set(['FLAG_UV4', 'FLAG_UV5', 'FLAG_UV6', 'FLAG_UV7'])

const declaration = ({ name, value, doc }: RustConstant) =>
  `${doc.length ? `/**\n${comment(doc, ' * ')}\n */\n` : ''}${TABLE_ONLY.has(name) ? '' : 'export '}const ${RENAMED[name] ?? name} = ${value}`

/** The page format's constants, printed for the TypeScript readers. */
export function pageFormatTs() {
  const { page, deform, triangles, dag } = codec()
  const flags = [
    ...exported(page, [
      'FLAG_NORMAL',
      'FLAG_UV',
      'FLAG_UV1',
      'FLAG_COLOR',
      'FLAG_SOFT_SOURCE',
      'FLAG_TANGENT',
      'FLAG_UV2',
      'FLAG_UV3',
      'FLAG_UV4',
      'FLAG_UV5',
      'FLAG_UV6',
      'FLAG_UV7',
      'FLAG_UV_EXTENDED',
    ]),
    ...exported(deform, ['FLAG_SKIN', 'FLAG_MORPH']),
  ]
  const items = [
    ...exported(page, [
      'MAGIC',
      'VERSION',
      'RESIDENT_VERSION',
      'HEADER_WORDS',
      'DISK_HEADER_WORDS',
      'RESIDENT_TABLE_WORDS',
    ]),
    ...flags,
    ...exported(page, [
      'MAX_PAGE_TRIANGLES',
      'MAX_PAGE_VERTICES',
      'MAX_PAGE_CORNERS',
      'STRIP_REF_BITS',
      'REF_PLACE_BITS',
      'SELF_PLACE',
      'NO_UNIT',
      'MAX_UV_SETS',
      'HEADER_UV_SETS',
      'UV_EXTENSION_WORDS',
      'CENTIMETRES_PER_METRE',
      'MIN_POSITION_PRECISION',
      'MAX_POSITION_PRECISION',
      'MAX_NORMAL_PRECISION',
      'MAX_TANGENT_PRECISION',
      'DEFAULT_NORMAL_PRECISION',
      'DEFAULT_TANGENT_PRECISION',
      'UV_EXPONENT_BITS',
      'UV_MANTISSA_BITS',
      'COLOR_LEVELS',
    ]),
    ...exported(deform, ['MAX_MORPH_TARGETS', 'MORPH_WORDS']),
    ...exported(triangles, ['TRIANGLE_BLOCK', 'BLOCK_CORNERS', 'WIDTH_BITS']),
    ...exported(dag, ['DAG_CLUSTER_TRIANGLES', 'DAG_CLUSTER_VERTICES']),
  ]
  const attributes = rustSource(`${CODEC}/attributes.rs`)
  const optional = [...attributes.matchAll(/\((FLAG_\w+), (\d+)\),/g)]
  if (optional.length !== OPTIONAL_NAMES.length)
    throw new Error(
      `attributes.rs: OPTIONAL no longer lists the readers' ${OPTIONAL_NAMES.length} attributes`,
    )
  return `${header([`${CODEC}/lib.rs`, `${CODEC}/bits.rs`, `${CODEC}/deform.rs`, `${CODEC}/triangles.rs`, `${CODEC}/attributes.rs`, 'packages/asset-compiler-rust/src/dag.rs'], '//')}
/** The \`WGP3\` quantized cluster page as every reader must know it (\`docs/FORMAT.md\`). */

${items.map(declaration).join('\n\n')}

/** Decoded name, float width and presence bit of each optional attribute, in stream order. */
export const OPTIONAL = [
${optional.map(([, flag, size], i) => `  ['${OPTIONAL_NAMES[i]}', ${size}, ${flag}],`).join('\n')}
] as const
`
}

/** A WASM ABI module's words, printed for the SDK module's loader: the `pub const` counts and the
 *  `pub mod` word tables of the Rust file `path`, each table under the doc line given. */
function wasmAbiTs(path: string, counts: string[], tables: [string, string, string][]) {
  const constants = rustConstants(path)
  const scoped = (scope: string) => constants.filter((constant) => constant.scope[0] === scope)
  const object = (scope: string, name: string) => `export const ${name} = {
${scoped(scope)
  .map(({ name, value }) => `  ${name}: ${value},`)
  .join('\n')}
} as const`
  const words = (name: string) =>
    exported(
      constants.filter((c) => !c.scope.length),
      [name],
    )[0]
  return `${header([path], '//')}
${counts.map((name) => declaration(words(name))).join('\n\n')}

${tables.map(([scope, name, doc]) => `/** ${doc} */\n${object(scope, name)}`).join('\n\n')}
`
}

/** The page encoder's request words and the answer words of the encoder and the decoder's check,
 *  printed for the SDK module's loader. */
export function pageEncoderAbiTs() {
  return wasmAbiTs(
    `${CODEC}/wasm/encode.rs`,
    ['REQUEST_WORDS', 'META_WORDS', 'POOL_WORDS'],
    [
      ['request', 'REQUEST', "The request's words, by what each holds."],
      ['meta', 'META', "The answer's words on success."],
    ],
  )
}
