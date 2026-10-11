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
    grid: read('bits/grid.rs'),
    dag: rustConstants('packages/asset-compiler-rust/src/dag.rs', known),
  }
}

/** The TypeScript names the readers know three of the page's constants by. */
const RENAMED: Record<string, string> = {
  MAGIC: 'CLUSTER_PAGE_MAGIC',
  VERSION: 'GEOMETRY_PAGE_FORMAT_VERSION',
  HEADER_WORDS: 'CLUSTER_HEADER_WORDS',
}

/** The decoded name of each optional attribute, in the order `OPTIONAL` (`attributes.rs`) lists
 *  them: the names are the readers', the flags and widths the codec's. */
const OPTIONAL_NAMES = ['normal', 'uv', 'uv2', 'color']

const exported = (constants: readonly RustConstant[], names: readonly string[]) =>
  names.map((name) => {
    const found = constants.find((constant) => constant.name === name)
    if (!found) throw new Error(`${CODEC}: no constant '${name}'`)
    return found
  })

/** The constants a reader recognises by their hexadecimal digits. */
const HEX = new Set(['MAGIC'])

const declaration = ({ name, value, doc }: RustConstant) =>
  `${doc.length ? `/**\n${comment(doc, ' * ')}\n */\n` : ''}export const ${RENAMED[name] ?? name} = ${HEX.has(name) ? `0x${value.toString(16)}` : value}`

/** The page format's constants, printed for the TypeScript readers. */
export function pageFormatTs() {
  const { page, bits, deform, triangles, grid, dag } = codec()
  const flags = [
    ...exported(page, [
      'FLAG_NORMAL',
      'FLAG_UV',
      'FLAG_UV1',
      'FLAG_COLOR',
      'FLAG_SOFT_SOURCE',
      'FLAGS_ALL',
    ]),
    ...exported(deform, ['FLAG_SKIN', 'FLAG_MORPH']),
  ]
  const items = [
    ...exported(page, ['MAGIC', 'VERSION', 'HEADER_WORDS']),
    ...flags,
    ...exported(deform, ['MAX_JOINT_BITS', 'MAX_MORPH_TARGETS', 'MORPH_WORDS']),
    ...exported(triangles, ['TRIANGLE_BLOCK', 'BLOCK_CORNERS', 'WIDTH_BITS', 'MAX_WIDTH']),
    ...exported(bits, ['MAX_BITS', 'MAX_EXPONENT']),
    ...exported(grid, ['UV_EXPONENT']),
    ...exported(dag, ['DAG_CLUSTER_TRIANGLES', 'DAG_CLUSTER_VERTICES']),
  ]
  const attributes = rustSource(`${CODEC}/attributes.rs`)
  const optional = [...attributes.matchAll(/\((FLAG_\w+), (\d+)\),/g)]
  if (optional.length !== OPTIONAL_NAMES.length)
    throw new Error("attributes.rs: OPTIONAL no longer lists the readers' four attributes")
  return `${header([`${CODEC}/lib.rs`, `${CODEC}/bits.rs`, `${CODEC}/deform.rs`, `${CODEC}/triangles.rs`, `${CODEC}/bits/grid.rs`, `${CODEC}/attributes.rs`, 'packages/asset-compiler-rust/src/dag.rs'], '//')}
/** The \`WGP3\` quantized cluster page as every reader must know it (\`docs/FORMAT.md\`). */

${items.map(declaration).join('\n\n')}

/** Decoded name, float width and presence bit of each optional attribute, in stream order. */
export const OPTIONAL = [
${optional.map(([, flag, size], i) => `  ['${OPTIONAL_NAMES[i]}', ${size}, ${flag}],`).join('\n')}
] as const
`
}

/** The page encoder's request and answer words, printed for the SDK module's loader. */
export function pageEncoderAbiTs() {
  const path = `${CODEC}/wasm_encode.rs`
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
${declaration(words('REQUEST_WORDS'))}

${declaration(words('META_WORDS'))}

/** The request's words, by what each holds. */
${object('request', 'REQUEST')}

/** The answer's words on success. */
${object('meta', 'META')}
`
}
