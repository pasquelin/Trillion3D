// The formats the compiler writes and the runtime reads, printed for the runtime
// (`../generate-shared-rules.ts`): the Rust compiler owns the version, the magic and the layout
// numbers of the manifest's binary, the resident proxy, the cutout answer sheet, the voxel
// section, the world roots' products and the animation banks, and
// `packages/sdk-core/src/contracts/writtenFormats.ts` carries them to the readers, which re-export
// the ones their module is the home of.
import { posix } from 'node:path'
import { REPOSITORY_ROOT } from '../../git/repository-files.ts'
import { comment, header } from './statements.ts'
import { type RustConstant, rustConstants, rustString } from './rust.ts'
import { git } from '../../git/git-paths.ts'

const COMPILER = 'packages/asset-compiler-rust/src'
/** A written file's path from the repository root: the compiler's own, or a sibling crate's (`../../`). */
const located = (file: string) => posix.normalize(`${COMPILER}/${file}`)

/** Each Rust file and the constants it owns: the Rust name, then the name the readers know it by
 *  when they differ. */
const WRITTEN: readonly (readonly [string, readonly (string | readonly [string, string])[]])[] = [
  [
    'manifest_binary/version.rs',
    ['MANIFEST_BINARY_VERSION', 'MANIFEST_BINARY_MAGIC', 'MANIFEST_BINARY_HEADER_WORDS'],
  ],
  ['proxy.rs', ['SCENE_PROXY_VERSION', 'SCENE_PROXY_MAGIC', 'SCENE_PROXY_HEADER_WORDS']],
  [
    '../../page-codec-wasm/src/proxy.rs',
    [
      'PROXY_TRIANGLE_FLOATS',
      'PROXY_NODE_FLOATS',
      'PROXY_CHILDREN',
      'PROXY_CHILD_WORDS',
      'PROXY_NODE_WORDS',
    ],
  ],
  ['../../page-codec-wasm/src/wasm/proxy.rs', ['PROXY_META_WORDS']],
  [
    '../../page-codec-wasm/src/culling.rs',
    ['CULLING_FANOUT', 'CULLING_STRIDE', 'CULLING_RECORD_FLOATS'],
  ],
  ['../../page-codec-wasm/src/wasm/clusters.rs', ['CLUSTER_SPATIAL', 'CLUSTER_ORDERED']],
  ['cutout.rs', [['SHEET_VERSION', 'CUTOUT_SHEET_VERSION']]],
  ['voxel.rs', ['VOXEL_VERSION']],
  [
    'voxel/bricks.rs',
    [
      ['BRICK_BYTES', 'VOXEL_BRICK_BYTES'],
      ['VOXEL_BYTES', 'VOXEL_RECORD_BYTES'],
    ],
  ],
  [
    '../../page-codec-wasm/src/voxel.rs',
    [
      'VOXEL_PAGE_MAGIC',
      'VOXEL_PAGE_HEAD_WORDS',
      'VOXEL_BRICK_WORDS',
      'VOXEL_PAGE_BRICKS',
      'VOXEL_BRICK_CORNERS',
      'VOXEL_BRICK_TRIANGLES',
      'GEOMETRY_VOXEL',
    ],
  ],
  ['hlod/chain.rs', ['WORLD_ROOTS_VERSION']],
  ['hlod/chain/builds/instanced.rs', [['ROW_BYTES', 'WORLD_ROOTS_ROW_BYTES']]],
  ['lib.rs', [['STREAM_BUNDLE_BYTES', 'STREAMING_PAGE_BYTES']]],
  ['texture.rs', ['TEXTURE_PREVIEW_VERSION', 'PREVIEW_BASE']],
  ['texture/levels.rs', ['TILE_SIZE', 'TILE_BORDER']],
  ['physics_cook.rs', ['PHYSICS_FORMAT_VERSION', 'PIECES_FORMAT_VERSION']],
  [
    'compiler/tables/motion/bank.rs',
    [
      'ANIMATION_BANKS_VERSION',
      'ANIMATION_BANKS_MAGIC',
      'ANIMATION_BANKS_HEADER_WORDS',
      'ANIMATION_BANK_BAKE_WORDS',
      'ANIMATION_BANK_ITEM_WORDS',
      'ANIMATION_BANK_KEY_FLOATS',
      'ANIMATION_BANK_INVERSE_FLOATS',
      'ANIMATION_BANK_LOOPING',
    ],
  ],
]

/** The constants whose magic is read as hexadecimal digits, as the files' bytes spell it. */
const HEX = /_MAGIC$/

const docOf = (doc: readonly string[]) => (doc.length ? `/**\n${comment(doc, ' * ')}\n */\n` : '')

const joltDoc = [
  "The Jolt commit the engine's physics module is built from: the pin of the submodule",
  "`packages/physics-jolt-wasm/JoltPhysics`, read from the index as the compiler's cook reads",
  'the submodule head (`build.rs`).',
]

/** The commit the index pins the Jolt submodule to. */
function joltCommit() {
  const entry = git(REPOSITORY_ROOT, 'ls-files', '-s', 'packages/physics-jolt-wasm/JoltPhysics')
  const commit = entry.split(/\s+/)[1]
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('the Jolt submodule has no pin')
  return commit
}

/** The written formats' constants, printed for the runtime's readers. */
export function writtenFormatsTs() {
  const files = WRITTEN.map(([file]) => located(file))
  const declarations = WRITTEN.flatMap(([file, names]) => {
    const path = located(file)
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
  const banks = rustString(`${COMPILER}/compiler/tables/motion/bank.rs`, 'ANIMATION_BANKS_FILE')
  declarations.push(`${docOf(banks.doc)}export const ANIMATION_BANKS_FILE = '${banks.value}'`)
  declarations.push(`${docOf(joltDoc)}export const JOLT_COMMIT = '${joltCommit()}'`)
  return `${header(files, '//')}
${declarations.join('\n\n')}
`
}
