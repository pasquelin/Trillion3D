// The formats the compiler writes and the runtime reads, printed for the runtime
// (`../generate-shared-rules.ts`): the Rust compiler owns the version, the magic and the layout
// numbers of the manifest's binary, the resident proxy, the cutout answer sheet and the impostor
// section, and `packages/sdk-core/src/contracts/writtenFormats.ts` carries them to the readers,
// which re-export the ones their module is the home of.
import { comment, header } from './statements.ts'
import { type RustConstant, rustConstants, rustString } from './rust.ts'

const COMPILER = 'packages/asset-compiler-rust/src'

/** Each Rust file and the constants it owns: the Rust name, then the name the readers know it by
 *  when they differ. */
const WRITTEN: readonly (readonly [string, readonly (string | readonly [string, string])[]])[] = [
  [
    'manifest_binary/version.rs',
    ['MANIFEST_BINARY_VERSION', 'MANIFEST_BINARY_MAGIC', 'MANIFEST_BINARY_HEADER_WORDS'],
  ],
  [
    'proxy.rs',
    [
      'SCENE_PROXY_VERSION',
      'SCENE_PROXY_MAGIC',
      'SCENE_PROXY_HEADER_WORDS',
      'PROXY_TRIANGLE_FLOATS',
      'PROXY_NODE_FLOATS',
      'PROXY_CHILDREN',
      'PROXY_CHILD_WORDS',
      'PROXY_NODE_WORDS',
    ],
  ],
  ['cutout.rs', [['SHEET_VERSION', 'CUTOUT_SHEET_VERSION']]],
  ['impostor/stage.rs', ['IMPOSTOR_VERSION']],
]

/** The constants whose magic is read as hexadecimal digits, as the files' bytes spell it. */
const HEX = /_MAGIC$/

const docOf = (doc: readonly string[]) => (doc.length ? `/**\n${comment(doc, ' * ')}\n */\n` : '')

/** The written formats' constants, printed for the runtime's readers. */
export function writtenFormatsTs() {
  const files = WRITTEN.map(([file]) => `${COMPILER}/${file}`)
  const declarations = WRITTEN.flatMap(([file, names]) => {
    const path = `${COMPILER}/${file}`
    const constants = rustConstants(path)
    return names.map((entry) => {
      const [rust, name] = typeof entry === 'string' ? [entry, entry] : entry
      const found: RustConstant | undefined = constants.find((constant) => constant.name === rust)
      if (!found) throw new Error(`${path}: no constant '${rust}'`)
      const value = HEX.test(name) ? `0x${found.value.toString(16)}` : found.value
      return `${docOf(found.doc)}export const ${name} = ${value}`
    })
  })
  const sheet = rustString(`${COMPILER}/cutout.rs`, 'DECISIONS_FILE')
  declarations.push(`${docOf(sheet.doc)}export const CUTOUT_SHEET_FILE = '${sheet.value}'`)
  return `${header(files, '//')}
${declarations.join('\n\n')}
`
}
